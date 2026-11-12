// Design Ref: 출발지 기록·즐겨찾기 — 이 컴퓨터의 브라우저에만 저장한다 (서버로 보내지 않음). 주소와 좌표만 저장한다.

import { isInKorea } from "@/lib/core/parcels";
import type { Coord } from "@/lib/core/types";

export const MAX_RECENT_ORIGINS = 10;
export const MAX_FAVORITES = 5;
export const MAX_FAVORITE_NAME = 10;
export const MAP_PICK_LABEL = "지도에서 찍은 위치";

export type PlaceEntry = { address: string; coord: Coord };
export type Favorite = PlaceEntry & { id: string; name: string };
export type StoredPlaces = { recents: PlaceEntry[]; favorites: Favorite[] };

export const EMPTY_PLACES: StoredPlaces = { recents: [], favorites: [] };

function sameSpot(a: Coord, b: Coord): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}

/** 최근 출발지에 넣는다. 같은 위치는 하나로 합쳐 맨 앞으로 올리고, 10개를 넘으면 오래된 것부터 버린다. */
export function addRecent(recents: readonly PlaceEntry[], entry: PlaceEntry): PlaceEntry[] {
  const address = entry.address.trim() || MAP_PICK_LABEL;
  const rest = recents.filter((r) => !sameSpot(r.coord, entry.coord));
  return [{ address, coord: entry.coord }, ...rest].slice(0, MAX_RECENT_ORIGINS);
}

export function removeRecent(recents: readonly PlaceEntry[], coord: Coord): PlaceEntry[] {
  return recents.filter((r) => !sameSpot(r.coord, coord));
}

export type AddFavoriteResult = { ok: true; favorites: Favorite[] } | { ok: false; message: string };

/** 즐겨찾기를 등록한다 (이름 필수, 최대 5개, 같은 이름은 불가). */
export function addFavorite(favorites: readonly Favorite[], name: string, entry: PlaceEntry, id: string): AddFavoriteResult {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, message: "이름을 입력해 주세요. (예: 집, 회사)" };
  if (trimmed.length > MAX_FAVORITE_NAME) return { ok: false, message: `이름은 ${MAX_FAVORITE_NAME}자 이하로 적어 주세요.` };
  if (favorites.some((f) => f.name === trimmed)) return { ok: false, message: "같은 이름이 이미 있어요." };
  if (favorites.length >= MAX_FAVORITES) return { ok: false, message: `즐겨찾기는 최대 ${MAX_FAVORITES}개까지예요. 하나를 지운 뒤 등록해 주세요.` };
  return { ok: true, favorites: [...favorites, { id, name: trimmed, address: entry.address.trim() || MAP_PICK_LABEL, coord: entry.coord }] };
}

export function removeFavorite(favorites: readonly Favorite[], id: string): Favorite[] {
  return favorites.filter((f) => f.id !== id);
}

function isCoord(v: unknown): v is Coord {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.lat === "number" && typeof c.lng === "number" && isInKorea({ lat: c.lat, lng: c.lng });
}

/** 저장소에서 읽은 글자를 검사해 쓸 수 있는 것만 돌려준다. 깨졌으면 빈 목록. */
export function parseStoredPlaces(raw: string | null): StoredPlaces {
  if (!raw) return EMPTY_PLACES;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return EMPTY_PLACES;
    const { recents, favorites } = data as { recents?: unknown; favorites?: unknown };
    const okRecents = (Array.isArray(recents) ? recents : [])
      .filter((r): r is PlaceEntry => typeof r?.address === "string" && isCoord(r?.coord))
      .slice(0, MAX_RECENT_ORIGINS)
      .map((r) => ({ address: r.address, coord: { lat: r.coord.lat, lng: r.coord.lng } }));
    const okFavorites = (Array.isArray(favorites) ? favorites : [])
      .filter((f): f is Favorite => typeof f?.id === "string" && typeof f?.name === "string" && typeof f?.address === "string" && isCoord(f?.coord))
      .slice(0, MAX_FAVORITES)
      .map((f) => ({ id: f.id, name: f.name, address: f.address, coord: { lat: f.coord.lat, lng: f.coord.lng } }));
    return { recents: okRecents, favorites: okFavorites };
  } catch {
    return EMPTY_PLACES;
  }
}
