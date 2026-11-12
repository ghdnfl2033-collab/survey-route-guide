// Design Ref: §4 날씨(nice) — 서버(/api/weather)에서 오늘부터 며칠 치 날씨를 받는다. 위치(좌표)만 보낸다.
// 실패해도 동선 계산에는 영향이 없도록, 실패는 오류를 던지지 않고 null로 알린다.

import type { DayWeather } from "@/lib/core/weather";
import type { Coord } from "@/lib/core/types";

const isDay = (v: unknown): v is DayWeather => {
  const d = v as DayWeather;
  return (
    typeof d === "object" &&
    d !== null &&
    typeof d.date === "string" &&
    Number.isFinite(d.tempMin) &&
    Number.isFinite(d.tempMax) &&
    Number.isFinite(d.popMax) &&
    typeof d.sky === "string" &&
    typeof d.precipitation === "string"
  );
};

/** 조사 지역(좌표)의 날씨 예보. 받지 못하면 null. */
export async function fetchForecasts(coord: Coord, fetchImpl: typeof fetch = fetch): Promise<DayWeather[] | null> {
  try {
    const res = await fetchImpl("/api/weather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: coord.lat, lng: coord.lng }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.forecasts) || !body.forecasts.every(isDay)) return null;
    return body.forecasts as DayWeather[];
  } catch {
    return null;
  }
}

/** 고른 필지들의 가운데 위치 (날씨를 볼 지역) */
export function centerOf(coords: readonly Coord[]): Coord | null {
  if (coords.length === 0) return null;
  const sum = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat, lng: acc.lng + c.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / coords.length, lng: sum.lng / coords.length };
}
