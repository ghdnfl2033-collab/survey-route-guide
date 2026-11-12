import { KakaoAuthError } from "@/lib/server/kakao";
import { fetchWalkLegs, MAX_WALK_LEGS } from "@/lib/server/kakaoWalk";
import { fetchTransitLegs } from "@/lib/server/kakaoTransit";
import { fetchCarLegs } from "@/lib/server/kakaoNavi";
import { isInKorea } from "@/lib/core/parcels";
import type { Coord } from "@/lib/core/types";

// Design Ref: §5 — POST /api/route-legs: 순서가 정해진 지점들을 이은 구간별 실제 시간·거리. 좌표만 받고, 받은 값은 저장하지 않는다.
// (접속 코드를 통과하지 않은 요청은 proxy.ts가 먼저 401로 막는다)
// legs[i]는 points[i] → points[i+1] 구간이다. 도보(walk)·대중교통(transit)·자차(car)를 지원한다.
// 대중교통은 경로가 없는 구간을 걷는 시간으로 대신하고(walk: true), 구간마다 환승 횟수(transfers)를 함께 돌려준다.
// 자차는 구간의 도착점과 길찾기가 실제로 끝나는 도로 끝 사이의 거리(endGapMeters)를 함께 돌려준다.
const MAX_POINTS = MAX_WALK_LEGS + 1;

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function isCoord(v: unknown): v is Coord {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Coord).lat === "number" &&
    typeof (v as Coord).lng === "number" &&
    isInKorea(v as Coord)
  );
}

export async function POST(request: Request) {
  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) {
    return error(500, "NOT_CONFIGURED", "서버에 길찾기 서비스 키가 설정되지 않았어요. 관리자에게 알려 주세요.");
  }

  let body: { points?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, "INVALID_INPUT", "지점 목록을 보내 주세요.");
  }

  if (body.mode !== "walk" && body.mode !== "transit" && body.mode !== "car") {
    return error(400, "UNSUPPORTED_MODE", "이동 수단은 자차, 대중교통, 도보 중 하나여야 해요.");
  }
  const { points } = body;
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS || !points.every(isCoord)) {
    return error(400, "INVALID_INPUT", `지점은 대한민국 안의 좌표 2~${MAX_POINTS}개로 보내 주세요.`);
  }

  try {
    const route = points as Coord[];
    const legs =
      body.mode === "walk"
        ? await fetchWalkLegs(route, restKey)
        : body.mode === "transit"
          ? await fetchTransitLegs(route, restKey)
          : await fetchCarLegs(route, restKey);
    return Response.json({ legs });
  } catch (e) {
    if (e instanceof KakaoAuthError) {
      return error(
        502,
        "ROUTE_SERVICE_REJECTED",
        "길찾기 서비스가 요청을 거부했어요. 카카오 개발자 설정과 키를 확인해 주세요.",
      );
    }
    return error(502, "ROUTE_SERVICE_FAILED", "길찾기 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.");
  }
}
