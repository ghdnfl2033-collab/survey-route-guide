import { weatherAdvice, type DayWeather } from "@/lib/core/weather";
import type { TravelMode } from "@/lib/core/types";

export type WeatherState = { status: "loading" } | { status: "done"; forecasts: DayWeather[] | null };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-11-13" → "11/13(금)" */
function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

// Design Ref: §3.3 ④ 결과 — 결과 화면 위쪽에 조사 예정일의 날씨·기온·강수 확률 (nice). 가져오지 못해도 동선 계산은 그대로 진행한다.
export default function WeatherNotice({ weather, date, mode }: { weather: WeatherState; date: string; mode: TravelMode }) {
  if (weather.status === "loading") {
    return <p className="text-xs text-zinc-500">날씨를 확인하는 중이에요…</p>;
  }
  if (weather.forecasts === null) {
    return <p className="text-xs text-zinc-500">날씨 정보를 가져오지 못했어요. 동선 계산에는 영향이 없어요.</p>;
  }
  const day = weather.forecasts.find((f) => f.date === date);
  if (!day) {
    const last = weather.forecasts.at(-1)?.date;
    return (
      <p className="text-xs text-zinc-500">
        {shortDate(date)}의 날씨 예보는 아직 없어요.{last ? ` 예보는 ${shortDate(last)}까지 볼 수 있어요.` : ""}
      </p>
    );
  }
  const advice = weatherAdvice(day, mode);
  return (
    <div className="space-y-1">
      <p className="text-xs text-zinc-700 dark:text-zinc-300">
        <strong>날씨 {shortDate(day.date)}</strong> · {day.sky}
        {day.precipitation !== "없음" && ` (${day.precipitation})`} · {day.tempMin}~{day.tempMax}℃ · 강수 확률 {day.popMax}%
        <span className="ml-1 text-zinc-400">(기상청 예보, 조사 지역 기준)</span>
      </p>
      {advice.rainy && (
        <p role="note" className="rounded border border-sky-400 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
          <strong>☔ {advice.message}</strong>
        </p>
      )}
    </div>
  );
}
