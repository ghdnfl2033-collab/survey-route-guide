// Design Ref: §3.4 ② 필지 고르기 — 동선에 넣을 필지 선택 규칙 (순수 계산)
// Plan SC: PRD 5장 must 1 — 동선에는 최대 30필지까지만, 위치 없는 필지는 고를 수 없다

import { MAX_PARCELS_PER_ROUTE, type Parcel } from "./types";

export type BlockedReason = "limit" | "noLocation" | "unknown";

export type ToggleResult = {
  /** 선택된 필지 id (고른 순서) */
  selected: string[];
  /** 선택하지 못한 이유 (해제나 정상 선택이면 없음) */
  blocked?: BlockedReason;
};

/** 필지 하나를 선택하거나 해제한다. 30개를 넘게 고르거나 위치 없는 필지는 막는다. */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  parcels: readonly Parcel[],
  max: number = MAX_PARCELS_PER_ROUTE,
): ToggleResult {
  if (selected.includes(id)) return { selected: selected.filter((s) => s !== id) };

  const parcel = parcels.find((p) => p.id === id);
  if (!parcel) return { selected: [...selected], blocked: "unknown" };
  if (!parcel.coord) return { selected: [...selected], blocked: "noLocation" };
  if (selected.length >= max) return { selected: [...selected], blocked: "limit" };
  return { selected: [...selected, id] };
}

/** 위치를 찾은 필지를 목록 순서대로 앞에서부터 max개까지 선택한다. */
export function selectFirst(
  parcels: readonly Parcel[],
  max: number = MAX_PARCELS_PER_ROUTE,
): { selected: string[]; truncated: boolean } {
  const located = parcels.filter((p) => p.coord);
  return { selected: located.slice(0, max).map((p) => p.id), truncated: located.length > max };
}

/** 없어졌거나 위치가 없는 필지의 선택을 걸러낸다. */
export function pruneSelection(selected: readonly string[], parcels: readonly Parcel[]): string[] {
  const valid = new Set(parcels.filter((p) => p.coord).map((p) => p.id));
  return selected.filter((id) => valid.has(id));
}

export const BLOCKED_MESSAGES: Record<BlockedReason, string> = {
  limit: `한 동선에는 ${MAX_PARCELS_PER_ROUTE}필지까지 넣을 수 있어요.`,
  noLocation: "위치를 아직 모르는 필지는 고를 수 없어요. 지도에서 위치를 먼저 찍어 주세요.",
  unknown: "선택할 수 없는 필지예요.",
};
