// Design Ref: §4 날씨(nice) — 기상청 단기예보 응답을 조사 날짜의 날씨 요약으로 바꾼다 (순수 계산)
// Plan SC: PRD 5장 nice 날씨 — 날씨·기온·강수 확률 표시, 강수 확률 60% 이상이면 비 예보를 알리고 도보 대신 자차·대중교통 권장

import type { Coord, TravelMode } from "./types";

/** 강수 확률이 이 값 이상이면 비 예보로 본다 (PRD) */
export const RAIN_ALERT_POP = 60;

/** 현장 조사를 하는 시간대: 이 시각의 예보만 하루 요약에 쓴다 */
const FIELD_HOURS = { from: 6, to: 21 };

/** 기상청 예보 한 줄 (필요한 칸만) */
export type ForecastItem = { fcstDate: string; fcstTime: string; category: string; fcstValue: string };

export type Sky = "맑음" | "구름 많음" | "흐림";
export type Precipitation = "없음" | "비" | "비/눈" | "눈" | "소나기";

export type DayWeather = {
  /** "2026-11-13" */
  date: string;
  /** 하루 중 가장 낮은 기온 / 높은 기온 (℃) */
  tempMin: number;
  tempMax: number;
  /** 조사 시간대(06~21시)의 가장 높은 강수 확률 (%) */
  popMax: number;
  sky: Sky;
  precipitation: Precipitation;
};

/**
 * 위도·경도를 기상청 예보 격자 번호(nx, ny)로 바꾼다. (기상청이 공개한 람베르트 정각원추 도법 공식)
 * 서울시청 근처(37.5665, 126.978)는 (60, 127)이다.
 */
export function toForecastGrid(coord: Coord): { nx: number; ny: number } {
  const RE = 6371.00877; // 지구 반경 (km)
  const GRID = 5.0; // 격자 간격 (km)
  const D2R = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = 30 * D2R;
  const slat2 = 60 * D2R;
  const olon = 126 * D2R;
  const olat = 38 * D2R;
  const XO = 43;
  const YO = 136;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + coord.lat * D2R * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = coord.lng * D2R - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

/**
 * 지금(한국 시각) 받을 수 있는 가장 최근 예보 발표 시각. 발표는 02·05·08·11·14·17·20·23시이고,
 * 발표 10분 뒤부터 받을 수 있다. 오늘 02:10 전이면 어제 23시 발표를 쓴다.
 * now는 "한국 시각을 UTC 시각처럼 담은 Date"이다 (서버 시간대와 상관없이 같은 결과).
 */
export function latestBaseTime(nowKst: Date): { baseDate: string; baseTime: string } {
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const minutes = nowKst.getUTCHours() * 60 + nowKst.getUTCMinutes();
  let hour = [...slots].reverse().find((h) => minutes >= h * 60 + 10);
  const day = new Date(nowKst.getTime());
  if (hour === undefined) {
    hour = 23;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  const baseDate = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  return { baseDate, baseTime: `${String(hour).padStart(2, "0")}00` };
}

/** "20261113" → "2026-11-13" */
const dashed = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

const SKY_BY_CODE: Record<string, Sky> = { "1": "맑음", "3": "구름 많음", "4": "흐림" };
const PRECIPITATION_BY_CODE: Record<string, Precipitation> = { "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기" };

function mode<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** 예보 목록에서 날짜별 날씨 요약을 만든다. 기온이나 강수 확률을 알 수 없는 날은 뺀다. 날짜 순서로 돌려준다. */
export function summarizeForecast(items: readonly ForecastItem[]): DayWeather[] {
  const dates = [...new Set(items.map((i) => i.fcstDate))].sort();
  const result: DayWeather[] = [];
  for (const date of dates) {
    const today = items.filter((i) => i.fcstDate === date);
    const num = (category: string, fieldOnly: boolean) =>
      today
        .filter((i) => i.category === category)
        .filter((i) => {
          if (!fieldOnly) return true;
          const h = Number(i.fcstTime.slice(0, 2));
          return h >= FIELD_HOURS.from && h <= FIELD_HOURS.to;
        })
        .map((i) => Number(i.fcstValue))
        .filter((n) => Number.isFinite(n));
    const temps = num("TMP", false);
    // 하루 최저·최고 기온 항목이 따로 오면 그 값을, 없으면 시간별 기온에서 구한다
    const tmn = num("TMN", false);
    const tmx = num("TMX", false);
    const pops = num("POP", true);
    if ((temps.length === 0 && (tmn.length === 0 || tmx.length === 0)) || pops.length === 0) continue;

    const skyCodes = today
      .filter((i) => i.category === "SKY" && Number(i.fcstTime.slice(0, 2)) >= FIELD_HOURS.from && Number(i.fcstTime.slice(0, 2)) <= FIELD_HOURS.to)
      .map((i) => i.fcstValue);
    const ptyCodes = today
      .filter((i) => i.category === "PTY" && Number(i.fcstTime.slice(0, 2)) >= FIELD_HOURS.from && Number(i.fcstTime.slice(0, 2)) <= FIELD_HOURS.to)
      .map((i) => i.fcstValue)
      .filter((c) => c !== "0");

    result.push({
      date: dashed(date),
      tempMin: Math.round(tmn.length > 0 ? Math.min(...tmn) : Math.min(...temps)),
      tempMax: Math.round(tmx.length > 0 ? Math.max(...tmx) : Math.max(...temps)),
      popMax: Math.max(...pops),
      sky: SKY_BY_CODE[mode(skyCodes) ?? ""] ?? "구름 많음",
      precipitation: PRECIPITATION_BY_CODE[mode(ptyCodes) ?? "0"] ?? "없음",
    });
  }
  return result;
}

export type WeatherAdvice = { rainy: boolean; message: string };

/**
 * 날씨에 따른 안내 문구. 강수 확률이 60% 이상이면 비 예보를 알리고,
 * 도보로 계획했다면 자차나 대중교통을 권한다.
 */
export function weatherAdvice(weather: DayWeather, mode: TravelMode): WeatherAdvice {
  if (weather.popMax < RAIN_ALERT_POP) return { rainy: false, message: "" };
  const kind = weather.precipitation === "눈" ? "눈" : weather.precipitation === "비/눈" ? "비나 눈" : "비";
  const base = `${kind} 예보예요 (강수 확률 ${weather.popMax}%).`;
  return {
    rainy: true,
    message: mode === "walk" ? `${base} 걸어서 다니기 어려울 수 있어요. 도보 대신 자차나 대중교통을 권해요.` : `${base} 우산이나 우비를 챙기세요.`,
  };
}
