// Design Ref: §4.3 — 길찾기 서비스를 쓸 수 없을 때 직선거리로 구간 시간표를 대신 만든다
// Plan SC: PRD 5장 must 2 — 길찾기 서비스 연결에 실패하면 직선거리로 대신 계산하고 "추정값"이라고 분명히 표시한다
//
// 아래 숫자는 실제 측정값이 아니라 "대략 이 정도"라는 가정이다. 그래서 이 시간표로 만든 결과는 항상 추정값이다.

import { straightDistanceKm } from "./distance";
import type { Coord, TravelMode } from "./types";

/** 직선거리보다 실제 길은 보통 더 구불구불하다는 보정 (1.3배) */
export const DETOUR_FACTOR = 1.3;

/** 이동 수단별 평균 속도(km/h) 가정: 자차(시내+외곽 섞임), 대중교통(정류장 정차 포함), 도보 */
export const SPEED_KMH: Record<TravelMode, number> = { car: 30, transit: 20, walk: 4 };

/** 대중교통은 기다리는 시간과 환승 여유를 더한다 (구간마다 10분) */
export const TRANSIT_OVERHEAD_MINUTES = 10;

export type FallbackMatrix = {
  /** minutes[a][b] = a에서 b까지 걸리는 시간(분, 소수점 포함) */
  minutes: number[][];
  /** km[a][b] = a에서 b까지의 예상 거리(km) = 직선거리 × 보정값 */
  km: number[][];
};

/** 지점 목록(0번이 출발지)으로 직선거리 기반 구간 시간표를 만든다. */
export function buildFallbackMatrix(points: readonly Coord[], mode: TravelMode): FallbackMatrix {
  const size = points.length;
  const minutes: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const km: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      if (a === b) continue;
      const distance = straightDistanceKm(points[a], points[b]) * DETOUR_FACTOR;
      km[a][b] = distance;
      minutes[a][b] = (distance / SPEED_KMH[mode]) * 60 + (mode === "transit" ? TRANSIT_OVERHEAD_MINUTES : 0);
    }
  }
  return { minutes, km };
}
