import { KakaoAuthError, geocodeMany } from "@/lib/server/kakao";
import { MAX_ADDRESS_LENGTH } from "@/lib/core/excelRules";

// Design Ref: §5 — POST /api/geocode: 주소 → 좌표. 요청당 100건씩 나눠 보내며, 받은 주소는 저장하지 않는다.
// (접속 코드를 통과하지 않은 요청은 proxy.ts가 먼저 401로 막는다)
const MAX_ADDRESSES_PER_REQUEST = 100;

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) {
    return error(500, "NOT_CONFIGURED", "서버에 지도 서비스 키가 설정되지 않았어요. 관리자에게 알려 주세요.");
  }

  let addresses: unknown;
  try {
    ({ addresses } = await request.json());
  } catch {
    return error(400, "INVALID_INPUT", "주소 목록을 보내 주세요.");
  }

  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.length > MAX_ADDRESSES_PER_REQUEST ||
    !addresses.every((a) => typeof a === "string" && a.trim() !== "" && a.length <= MAX_ADDRESS_LENGTH)
  ) {
    return error(
      400,
      "INVALID_INPUT",
      `주소는 1~${MAX_ADDRESSES_PER_REQUEST}건의 글자 목록으로 보내 주세요.`,
    );
  }

  try {
    const results = await geocodeMany(addresses as string[], restKey);
    return Response.json({ results });
  } catch (e) {
    if (e instanceof KakaoAuthError) {
      return error(
        502,
        "MAP_SERVICE_REJECTED",
        "지도 서비스가 요청을 거부했어요. 카카오 개발자 설정에서 카카오맵 사용 설정과 키를 확인해 주세요.",
      );
    }
    return error(502, "MAP_SERVICE_FAILED", "위치를 찾는 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.");
  }
}
