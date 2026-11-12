import { KakaoAuthError } from "@/lib/server/kakao";
import { buildCarMatrixWithRoadEnds, MAX_DESTINATIONS } from "@/lib/server/kakaoNavi";
import { isInKorea } from "@/lib/core/parcels";
import type { Coord } from "@/lib/core/types";

// Design Ref: §5 — POST /api/matrix: 지점 사이의 구간 시간표(자차). 좌표만 받고, 받은 값은 저장하지 않는다.
// (접속 코드를 통과하지 않은 요청은 proxy.ts가 먼저 401로 막는다)
// 지점은 출발지 1개 + 필지 최대 30개 = 31개까지.
const MAX_POINTS = MAX_DESTINATIONS + 1;

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

  if (body.mode !== "car") {
    return error(400, "UNSUPPORTED_MODE", "지금은 자차 구간 시간표만 만들 수 있어요.");
  }
  const { points } = body;
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS || !points.every(isCoord)) {
    return error(400, "INVALID_INPUT", `지점은 대한민국 안의 좌표 2~${MAX_POINTS}개로 보내 주세요.`);
  }

  try {
    // 도로에서 먼 필지는 가까운 도로 지점으로 옮겨 계산하고, 그 정보(roadEnds·noRoad)를 함께 돌려준다
    const matrix = await buildCarMatrixWithRoadEnds(points as Coord[], restKey);
    return Response.json(matrix);
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
