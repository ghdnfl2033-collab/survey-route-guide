// Design Ref: §4.2 ③④ — 합친 주소 + 좌표 변환 결과로 필지를 만든다 (순수 계산)
// Plan SC: PRD 5장 must 1 — 위치를 못 찾은 필지는 짐작해서 넣지 않고 "확인 필요"로 둔다

import type { MergedAddress } from "./address";
import type { Coord, GeocodeItem, Parcel } from "./types";

function fromResult(address: string, rowNumbers: number[], result: GeocodeItem | undefined): Parcel {
  const id = `p-${rowNumbers[0]}`;
  if (result?.status === "found" && result.coord) {
    return { id, address, rowNumbers, coord: result.coord, coordSource: "kakao", needsCheck: false };
  }
  // 못 찾음(notFound)과 결과를 받지 못함(error·없음) 모두 좌표를 만들지 않고 "확인 필요"로 둔다
  return { id, address, rowNumbers, needsCheck: true, lookupFailed: result?.status !== "notFound" };
}

/** 합친 주소 목록과 같은 순서의 변환 결과로 필지 목록을 만든다. */
export function buildParcels(merged: readonly MergedAddress[], results: readonly GeocodeItem[]): Parcel[] {
  return merged.map((m, i) => fromResult(m.address, m.rowNumbers, results[i]));
}

/** 다시 찾은 결과(주소 기준)를 기존 필지 목록에 반영한다. 이미 위치를 가진 필지는 건드리지 않는다. */
export function applyRetryResults(parcels: readonly Parcel[], results: readonly GeocodeItem[]): Parcel[] {
  const byAddress = new Map(results.map((r) => [r.address, r]));
  return parcels.map((p) => {
    if (p.coord) return p;
    const result = byAddress.get(p.address);
    return result ? fromResult(p.address, p.rowNumbers, result) : p;
  });
}

export const hasLocation = (p: Parcel) => !!p.coord;

/** 대한민국 안(제주·울릉·독도 포함)의 대략적인 범위. 엉뚱한 곳을 찍는 실수를 막는 데 쓴다. */
export function isInKorea(coord: Coord): boolean {
  return (
    Number.isFinite(coord.lat) &&
    Number.isFinite(coord.lng) &&
    coord.lat >= 32.5 &&
    coord.lat <= 39 &&
    coord.lng >= 124 &&
    coord.lng <= 132
  );
}

/**
 * 사용자가 지도에서 직접 찍은 위치를 필지에 넣는다. (Design Ref: §3.3 — 위치를 못 찾은 필지는 사용자가 직접 찍는다)
 * 찍은 필지는 "확인 필요"에서 빠지고 출처는 manual로 남는다. 대한민국 밖이거나 없는 필지면 그대로 돌려준다.
 */
export function setManualLocation(parcels: readonly Parcel[], id: string, coord: Coord): Parcel[] {
  if (!isInKorea(coord)) return [...parcels];
  return parcels.map((p) =>
    p.id === id
      ? { ...p, coord: { lat: coord.lat, lng: coord.lng }, coordSource: "manual", needsCheck: false, lookupFailed: false }
      : p,
  );
}
