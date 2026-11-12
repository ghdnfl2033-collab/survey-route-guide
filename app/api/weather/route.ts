import { ForecastAuthError, fetchWeather } from "@/lib/server/kma";
import { isInKorea } from "@/lib/core/parcels";

// Design Ref: §5 — POST /api/weather: 좌표 하나 → 오늘부터 며칠 치 날씨 요약. 좌표만 받고 저장하지 않는다.
// (접속 코드를 통과하지 않은 요청은 proxy.ts가 먼저 401로 막는다)
function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey) {
    return error(500, "NOT_CONFIGURED", "서버에 날씨 서비스 키가 설정되지 않았어요. 관리자에게 알려 주세요.");
  }

  let lat: unknown;
  let lng: unknown;
  try {
    ({ lat, lng } = await request.json());
  } catch {
    return error(400, "INVALID_INPUT", "위치를 보내 주세요.");
  }
  if (typeof lat !== "number" || typeof lng !== "number" || !isInKorea({ lat, lng })) {
    return error(400, "INVALID_INPUT", "대한민국 안의 위치를 보내 주세요.");
  }

  try {
    const forecasts = await fetchWeather({ lat, lng }, serviceKey);
    return Response.json({ forecasts });
  } catch (e) {
    if (e instanceof ForecastAuthError) {
      return error(502, "WEATHER_SERVICE_REJECTED", "날씨 서비스가 요청을 거부했어요. 공공데이터포털에서 기상청 단기예보 활용 신청과 키를 확인해 주세요.");
    }
    return error(502, "WEATHER_SERVICE_FAILED", "날씨를 가져오지 못했어요. 동선 계산에는 영향이 없어요.");
  }
}
