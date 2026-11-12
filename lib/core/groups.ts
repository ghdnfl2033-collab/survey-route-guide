// Design Ref: §4 ParcelGroup — 필지 묶음(nice 2). 브라우저 저장소에 주소+좌표만 저장한다 (순수 계산, 저장 자체는 lib/client/groupStorage.ts)
// Plan SC: PRD 5장 nice 2 — 묶음당 최대 30필지, 최대 20개(넘으면 오래된 묶음을 지우라고 안내), 이름 바꾸기·삭제, 조사 메모·개인정보는 저장하지 않는다

import { addressKey } from "./address";
import { isInKorea } from "./parcels";
import { MAX_PARCELS_PER_ROUTE, type Parcel } from "./types";

export const MAX_GROUPS = 20;
export const MAX_GROUP_NAME_LENGTH = 30;

/** 묶음에 저장하는 필지: 주소와 좌표만 (조사 기록·엑셀 줄 번호 등은 저장하지 않는다) */
export type SavedParcel = { address: string; lat: number; lng: number };

export type ParcelGroup = {
  id: string;
  name: string;
  /** 저장한 시각 (ISO 글자). 오래된 묶음을 알아보는 데 쓴다 */
  savedAt: string;
  parcels: SavedParcel[];
};

export type GroupResult = { ok: true; groups: ParcelGroup[] } | { ok: false; message: string };

/** 이름 앞뒤 공백을 없애고 검사한다. 문제가 있으면 안내 문구를 돌려준다. */
export function checkGroupName(
  name: string,
  groups: readonly ParcelGroup[],
  exceptId?: string,
): { name: string; error: "" } | { name: string; error: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") return { name: trimmed, error: "묶음 이름을 적어 주세요." };
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) return { name: trimmed, error: `이름은 ${MAX_GROUP_NAME_LENGTH}자까지 적을 수 있어요.` };
  if (groups.some((g) => g.id !== exceptId && g.name === trimmed)) return { name: trimmed, error: "같은 이름의 묶음이 이미 있어요." };
  return { name: trimmed, error: "" };
}

/** 지금 고른 필지로 새 묶음을 만든다. 위치 없는 필지는 넣지 않는다. */
export function addGroup(
  groups: readonly ParcelGroup[],
  name: string,
  selected: readonly Parcel[],
  now: Date = new Date(),
): GroupResult {
  const checked = checkGroupName(name, groups);
  if (checked.error) return { ok: false, message: checked.error };
  const located = selected.filter((p) => p.coord);
  if (located.length === 0) return { ok: false, message: "저장할 필지를 먼저 골라 주세요." };
  if (located.length > MAX_PARCELS_PER_ROUTE) return { ok: false, message: `묶음 하나에는 ${MAX_PARCELS_PER_ROUTE}필지까지 저장할 수 있어요.` };
  if (groups.length >= MAX_GROUPS) {
    return { ok: false, message: `묶음은 ${MAX_GROUPS}개까지 저장할 수 있어요. 오래된 묶음을 지운 뒤 다시 저장해 주세요.` };
  }
  const group: ParcelGroup = {
    id: `g-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: checked.name,
    savedAt: now.toISOString(),
    parcels: located.map((p) => ({ address: p.address, lat: p.coord!.lat, lng: p.coord!.lng })),
  };
  return { ok: true, groups: [...groups, group] };
}

export function renameGroup(groups: readonly ParcelGroup[], id: string, name: string): GroupResult {
  const checked = checkGroupName(name, groups, id);
  if (checked.error) return { ok: false, message: checked.error };
  return { ok: true, groups: groups.map((g) => (g.id === id ? { ...g, name: checked.name } : g)) };
}

export function deleteGroup(groups: readonly ParcelGroup[], id: string): ParcelGroup[] {
  return groups.filter((g) => g.id !== id);
}

export type ApplyResult = {
  /** 묶음의 필지가 더해진 필지 목록 */
  parcels: Parcel[];
  /** 지도에서 선택할 필지 id (묶음에 저장된 순서) */
  selectedIds: string[];
  /** 지금 목록에 없어서 새로 더한 필지 수 */
  added: number;
};

/**
 * 묶음을 불러온다: 지금 목록에 같은 주소가 있으면 그 필지를 고르고, 없으면 저장된 좌표로 새 필지를 더한다.
 * 지금 목록에서 위치를 못 찾은 같은 주소는 저장된 좌표로 채운다. 이미 위치가 있는 필지는 바꾸지 않는다.
 */
export function applyGroup(parcels: readonly Parcel[], group: ParcelGroup): ApplyResult {
  const next: Parcel[] = [...parcels];
  const byKey = new Map<string, number>();
  next.forEach((p, i) => byKey.set(addressKey(p.address), i));
  const usedIds = new Set(next.map((p) => p.id));
  const selectedIds: string[] = [];
  let added = 0;

  for (const saved of group.parcels) {
    if (!isInKorea({ lat: saved.lat, lng: saved.lng })) continue;
    const key = addressKey(saved.address);
    const at = byKey.get(key);
    if (at !== undefined) {
      const existing = next[at];
      if (!existing.coord) {
        next[at] = { ...existing, coord: { lat: saved.lat, lng: saved.lng }, coordSource: "saved", needsCheck: false, lookupFailed: false };
      }
      if (!selectedIds.includes(existing.id)) selectedIds.push(existing.id);
      continue;
    }
    let n = 1;
    while (usedIds.has(`${group.id}-${n}`)) n += 1;
    const id = `${group.id}-${n}`;
    usedIds.add(id);
    next.push({ id, address: saved.address, rowNumbers: [], coord: { lat: saved.lat, lng: saved.lng }, coordSource: "saved", needsCheck: false });
    byKey.set(key, next.length - 1);
    selectedIds.push(id);
    added += 1;
  }
  return { parcels: next, selectedIds: selectedIds.slice(0, MAX_PARCELS_PER_ROUTE), added };
}

/** 저장소에서 읽은 글자를 묶음 목록으로 바꾼다. 형식이 맞지 않는 것은 버리고 아무 문제 없는 것만 남긴다. */
export function parseStoredGroups(text: string | null): ParcelGroup[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const result: ParcelGroup[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const g = item as Record<string, unknown>;
    if (typeof g.id !== "string" || typeof g.name !== "string" || typeof g.savedAt !== "string" || !Array.isArray(g.parcels)) continue;
    const parcels: SavedParcel[] = [];
    for (const p of g.parcels) {
      const s = p as Record<string, unknown> | null;
      if (s && typeof s.address === "string" && typeof s.lat === "number" && typeof s.lng === "number") {
        // 주소와 좌표 외의 값은 읽지 않는다
        parcels.push({ address: s.address, lat: s.lat, lng: s.lng });
      }
    }
    if (parcels.length === 0) continue;
    result.push({ id: g.id, name: g.name.slice(0, MAX_GROUP_NAME_LENGTH), savedAt: g.savedAt, parcels: parcels.slice(0, MAX_PARCELS_PER_ROUTE) });
  }
  return result.slice(0, MAX_GROUPS);
}
