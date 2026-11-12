import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  needsRoadEndWalk,
  offsetCoord,
  PROBE_BEARINGS,
  probeRing,
  ROAD_END_THRESHOLD_M,
} from "@/lib/core/roadEnd";

const P = { lat: 37.45, lng: 126.95 };

describe("offsetCoord — 지점에서 일정 거리 떨어진 좌표", () => {
  it("지정한 거리만큼 떨어진다 (여러 방향·거리, 오차 1m 안)", () => {
    for (const meters of [100, 300, 1500, 3000]) {
      for (const bearing of [0, 45, 90, 180, 270, 315]) {
        expect(distanceMeters(P, offsetCoord(P, meters, bearing))).toBeCloseTo(meters, -0.3);
      }
    }
  });

  it("북쪽은 위도가 늘고, 동쪽은 경도가 는다", () => {
    expect(offsetCoord(P, 500, 0).lat).toBeGreaterThan(P.lat);
    expect(offsetCoord(P, 500, 90).lng).toBeGreaterThan(P.lng);
    expect(offsetCoord(P, 500, 180).lat).toBeLessThan(P.lat);
    expect(offsetCoord(P, 500, 270).lng).toBeLessThan(P.lng);
  });
});

describe("probeRing — 한 고리의 살펴볼 지점", () => {
  it("방향 수만큼 만들고, 모두 같은 거리에 있다", () => {
    const ring = probeRing(P, 700);
    expect(ring).toHaveLength(PROBE_BEARINGS);
    ring.forEach((c) => expect(distanceMeters(P, c)).toBeCloseTo(700, -0.3));
  });

  it("서로 다른 지점이다 (방향이 겹치지 않음)", () => {
    const ring = probeRing(P, 700).map((c) => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
    expect(new Set(ring).size).toBe(PROBE_BEARINGS);
  });
});

describe("needsRoadEndWalk — 표시 기준", () => {
  it("100m를 넘어야 표시한다 (정확히 100m는 아님)", () => {
    expect(ROAD_END_THRESHOLD_M).toBe(100);
    expect(needsRoadEndWalk(100)).toBe(false);
    expect(needsRoadEndWalk(100.5)).toBe(true);
    expect(needsRoadEndWalk(450)).toBe(true);
  });

  it("값이 없거나 숫자가 아니면 표시하지 않는다", () => {
    expect(needsRoadEndWalk(undefined)).toBe(false);
    expect(needsRoadEndWalk(null)).toBe(false);
    expect(needsRoadEndWalk(NaN)).toBe(false);
    expect(needsRoadEndWalk(5)).toBe(false);
  });
});
