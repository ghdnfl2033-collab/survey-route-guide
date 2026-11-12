// Design Ref: §5 — 기상청 단기예보(공공데이터포털) 조회. 좌표에서 만든 격자 번호만 보내고, 받은 값은 저장하지 않는다.

import { latestBaseTime, summarizeForecast, toForecastGrid, type DayWeather, type ForecastItem } from "@/lib/core/weather";
import type { Coord } from "@/lib/core/types";

const ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

/** 공공데이터포털이 키를 받아 주지 않을 때 (잘못된 키·승인 전 등) */
export class ForecastAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastAuthError";
  }
}

/** 응답 본문에서 예보 줄만 꺼낸다. 형식이 다르면 null. */
export function readForecastItems(body: unknown): ForecastItem[] | null {
  const items = (body as { response?: { body?: { items?: { item?: unknown } } } })?.response?.body?.items?.item;
  if (!Array.isArray(items)) return null;
  return items.flatMap((i) => {
    const v = i as Record<string, unknown>;
    return typeof v.fcstDate === "string" && typeof v.fcstTime === "string" && typeof v.category === "string" && typeof v.fcstValue === "string"
      ? [{ fcstDate: v.fcstDate, fcstTime: v.fcstTime, category: v.category, fcstValue: v.fcstValue }]
      : [];
  });
}

/**
 * 좌표 주변의 오늘부터 며칠 치 날씨를 날짜별로 요약해 돌려준다.
 * @param nowKst 한국 시각을 UTC처럼 담은 Date (발표 시각을 고르는 데 쓴다. 시험에서 바꿔 넣을 수 있다)
 */
export async function fetchWeather(
  coord: Coord,
  serviceKey: string,
  nowKst: Date = new Date(Date.now() + 9 * 3600_000),
  fetchImpl: typeof fetch = fetch,
): Promise<DayWeather[]> {
  const { nx, ny } = toForecastGrid(coord);
  const { baseDate, baseTime } = latestBaseTime(nowKst);
  const query = new URLSearchParams({
    serviceKey,
    pageNo: "1",
    numOfRows: "1000",
    dataType: "JSON",
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  });

  const res = await fetchImpl(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(8000) });
  if (res.status === 401 || res.status === 403) throw new ForecastAuthError("기상청 서비스가 요청을 거부했어요.");
  const text = await res.text();
  // 키 문제는 HTTP 200에 XML 오류로 오는 경우가 있다 (SERVICE_KEY_IS_NOT_REGISTERED_ERROR 등)
  if (/SERVICE[_ ]?KEY|UNREGISTERED|ACCESS_DENIED/i.test(text) && !text.trim().startsWith("{")) {
    throw new ForecastAuthError("기상청 서비스가 요청을 거부했어요.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("기상청 응답을 읽지 못했어요.");
  }
  const code = (body as { response?: { header?: { resultCode?: string } } })?.response?.header?.resultCode;
  if (code === "30" || code === "31" || code === "32") throw new ForecastAuthError("기상청 서비스가 요청을 거부했어요.");
  if (code !== "00") throw new Error("기상청 서비스에서 예보를 받지 못했어요.");
  const items = readForecastItems(body);
  if (!items) throw new Error("기상청 응답 형식이 달라요.");
  return summarizeForecast(items);
}
