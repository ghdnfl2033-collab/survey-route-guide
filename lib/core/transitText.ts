// 대중교통 이용 안내 글자 만들기 (결과표·엑셀 공통)

import type { Leg, Ride } from "./types";

/** 한 번 타는 구간 안내. 예: "2호선 을지로입구 승차 → 강남 하차 (21정거장)" */
export function rideText(ride: Ride): string {
  if (!ride.from || !ride.to) return ride.name;
  const count = ride.stops !== undefined ? ` (${ride.stops}정거장)` : "";
  return `${ride.name} ${ride.from} 승차 → ${ride.to} 하차${count}`;
}

/** 구간 하나의 이용 노선 안내 목록. 노선 정보가 없으면 도보 구간은 ["도보"], 그 밖에는 빈 목록 */
export function legRideTexts(leg: Leg | undefined): string[] {
  if (!leg) return [];
  if (leg.rides?.length) return leg.rides.map(rideText);
  if (leg.lines?.length) return leg.lines;
  return leg.walkFallback ? ["도보"] : [];
}
