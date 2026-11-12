// Design Ref: §4.3 — 차량 접근이 어려운 필지: 가장 가까운 도로 지점까지 계산하고 "도로 끝에서 도보 이동 필요" 표시 (순수 계산)
// Plan SC: PRD 5장 must 2 — 차량 접근이 어려운 필지(산 번지, 임야, 섬 등)는 가장 가까운 도로 지점까지 계산하고 표시한다

import { straightDistanceKm } from "./distance";
import type { Coord } from "./types";

/** 도로 끝과 필지 사이가 이보다 멀면 "도로 끝에서 도보 이동 필요"로 표시한다 (미터) */
export const ROAD_END_THRESHOLD_M = 100;

/** 도로를 찾을 때 필지 주변을 살피는 거리(미터): 가까운 고리부터 차례로 */
export const PROBE_RINGS_M = [300, 700, 1500, 3000];
/** 고리마다 살피는 방향 수 */
export const PROBE_BEARINGS = 7;

const EARTH_RADIUS_M = 6371000;

export function distanceMeters(a: Coord, b: Coord): number {
  return straightDistanceKm(a, b) * 1000;
}

/** 지점에서 방향(도, 북쪽이 0, 시계 방향)으로 meters만큼 떨어진 좌표 */
export function offsetCoord(from: Coord, meters: number, bearingDeg: number): Coord {
  const bearing = (bearingDeg * Math.PI) / 180;
  const dLat = ((meters * Math.cos(bearing)) / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = ((meters * Math.sin(bearing)) / (EARTH_RADIUS_M * Math.cos((from.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: from.lat + dLat, lng: from.lng + dLng };
}

/** 한 고리(거리 meters)에서 살펴볼 지점들: 방향을 고르게 나눈다. */
export function probeRing(target: Coord, meters: number, bearings: number = PROBE_BEARINGS): Coord[] {
  return Array.from({ length: bearings }, (_, i) => offsetCoord(target, meters, (360 / bearings) * i));
}

/** 도로 끝 거리가 표시 기준(100m)을 넘는지 */
export const needsRoadEndWalk = (meters: number | undefined | null): boolean =>
  typeof meters === "number" && Number.isFinite(meters) && meters > ROAD_END_THRESHOLD_M;
