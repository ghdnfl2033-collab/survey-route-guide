// Design Ref: §3.4 ③ 동선 설정 — 입력값 검사 (순수 계산)
// Plan SC: PRD 4·5장 — 출발지, 조사 날짜·출발 시각, 끝내는 곳, 이동 수단, 필지당 조사 시간(기본 10분, 변경 가능)

import { isInKorea } from "./parcels";
import { DEFAULT_INSPECT_MINUTES, type Coord, type RouteSettings, type TravelMode } from "./types";

export const MIN_INSPECT_MINUTES = 0;
export const MAX_INSPECT_MINUTES = 240;
export const DEFAULT_DEPART_TIME = "09:00";

export const MODE_LABELS: Record<TravelMode, string> = { car: "자차", transit: "대중교통", walk: "도보" };
export const END_MODE_LABELS: Record<RouteSettings["endMode"], string> = {
  return: "출발지로 돌아오기",
  lastParcel: "마지막 필지에서 끝내기",
};

/** 화면에서 입력 중인 값 (아직 검사 전이라 모두 글자) */
export type SettingsDraft = {
  originAddress: string;
  originCoord: Coord | null;
  date: string;
  departTime: string;
  endMode: RouteSettings["endMode"];
  mode: TravelMode;
  inspectMinutes: string;
};

export type SettingsErrors = Partial<Record<"origin" | "date" | "departTime" | "inspectMinutes", string>>;

export type SettingsResult = { ok: true; settings: RouteSettings } | { ok: false; errors: SettingsErrors };

export const DEFAULT_DRAFT_VALUES = {
  endMode: "return",
  mode: "car",
  inspectMinutes: String(DEFAULT_INSPECT_MINUTES),
} as const;

/** 오늘 날짜를 YYYY-MM-DD로 (사용자 컴퓨터의 시간 기준) */
export function todayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** 입력값을 검사해 동선 설정으로 바꾼다. 하나라도 틀리면 항목별 안내 문구를 돌려준다. */
export function validateSettings(draft: SettingsDraft, today: string): SettingsResult {
  const errors: SettingsErrors = {};

  const originAddress = draft.originAddress.trim();
  if (!draft.originCoord && originAddress === "") {
    errors.origin = "출발지 주소를 입력하거나 지도에서 직접 찍어 주세요.";
  } else if (!draft.originCoord || !isInKorea(draft.originCoord)) {
    errors.origin = "출발지 위치를 정해 주세요. 위치 찾기를 누르거나 지도에서 직접 찍어 주세요.";
  }

  if (!isRealDate(draft.date)) {
    errors.date = "조사 날짜를 골라 주세요.";
  } else if (draft.date < today) {
    errors.date = "오늘이나 그 이후 날짜를 골라 주세요.";
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.departTime)) {
    errors.departTime = "출발 시각을 골라 주세요.";
  }

  const minutesText = draft.inspectMinutes.trim();
  const minutes = Number(minutesText);
  if (!/^\d{1,3}$/.test(minutesText) || minutes < MIN_INSPECT_MINUTES || minutes > MAX_INSPECT_MINUTES) {
    errors.inspectMinutes = `${MIN_INSPECT_MINUTES}~${MAX_INSPECT_MINUTES}분 사이의 숫자로 입력해 주세요.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      origin: { address: originAddress || "지도에서 찍은 위치", coord: draft.originCoord as Coord },
      date: draft.date,
      departTime: draft.departTime,
      endMode: draft.endMode,
      mode: draft.mode,
      inspectMinutes: minutes,
    },
  };
}
