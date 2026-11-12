import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, legPoints, parseClock, planRoute, repricePlan, roadEndOverrides, routeDrawing, routePoints, type Timetable } from "@/lib/core/route";
import { buildFallbackMatrix, DETOUR_FACTOR, SPEED_KMH, TRANSIT_OVERHEAD_MINUTES } from "@/lib/core/fallback";
import type { Parcel, RouteSettings } from "@/lib/core/types";

const ORIGIN = { lat: 37.5665, lng: 126.978 }; // 서울시청
// 서울 안의 대략 비슷한 거리의 점들 (위도 0.01도 ≈ 1.1km)
const parcel = (n: number, dLat: number, dLng = 0): Parcel => ({
  id: `p-${n}`,
  address: `주소${n}`,
  rowNumbers: [n],
  coord: { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng + dLng },
  needsCheck: false,
});
const settings = (over: Partial<RouteSettings> = {}): RouteSettings => ({
  origin: { address: "출발지", coord: ORIGIN },
  date: "2026-11-20",
  departTime: "09:00",
  endMode: "return",
  mode: "car",
  inspectMinutes: 10,
  ...over,
});

describe("buildFallbackMatrix — 직선거리 시간표", () => {
  const pts = [ORIGIN, { lat: ORIGIN.lat + 0.1, lng: ORIGIN.lng }];

  it("같은 지점끼리는 0이고 오갈 때 값이 같다", () => {
    const { minutes, km } = buildFallbackMatrix(pts, "car");
    expect(minutes[0][0]).toBe(0);
    expect(km[1][1]).toBe(0);
    expect(minutes[0][1]).toBeCloseTo(minutes[1][0], 9);
  });

  it("거리는 직선거리 × 보정값, 시간은 속도로 나눈다", () => {
    const { minutes, km } = buildFallbackMatrix(pts, "walk");
    expect(km[0][1]).toBeCloseTo(11.12 * DETOUR_FACTOR, 1);
    expect(minutes[0][1]).toBeCloseTo((km[0][1] / SPEED_KMH.walk) * 60, 6);
  });

  it("같은 거리면 자차 < 대중교통 < 도보 순으로 오래 걸리고, 대중교통에는 대기 시간이 더해진다", () => {
    const car = buildFallbackMatrix(pts, "car").minutes[0][1];
    const transit = buildFallbackMatrix(pts, "transit").minutes[0][1];
    const walk = buildFallbackMatrix(pts, "walk").minutes[0][1];
    expect(car).toBeLessThan(transit);
    expect(transit).toBeLessThan(walk);
    const km = buildFallbackMatrix(pts, "transit").km[0][1];
    expect(transit).toBeCloseTo((km / SPEED_KMH.transit) * 60 + TRANSIT_OVERHEAD_MINUTES, 6);
  });
});

describe("planRoute — 동선 만들기 (직선거리 기준)", () => {
  const parcels = [parcel(1, 0.03), parcel(2, 0.01), parcel(3, 0.02), parcel(4, 0.04)];

  it("모든 필지를 정확히 1번씩 방문한다", () => {
    const plan = planRoute(settings(), parcels);
    expect([...plan.orderIds].sort()).toEqual(["p-1", "p-2", "p-3", "p-4"]);
  });

  it("출발지에서 시작해 가까운 곳부터 간다 (일직선 배치)", () => {
    const plan = planRoute(settings({ endMode: "lastParcel" }), parcels);
    expect(plan.orderIds).toEqual(["p-2", "p-3", "p-1", "p-4"]);
    expect(plan.legs[0].from).toBe("origin");
  });

  it("출발지로 돌아오기: 구간이 필지 수+1개이고 마지막은 출발지로 간다", () => {
    const plan = planRoute(settings({ endMode: "return" }), parcels);
    expect(plan.legs).toHaveLength(5);
    expect(plan.legs[4].to).toBe("origin");
    expect(plan.returnMinutes).toBeDefined();
  });

  it("마지막 필지에서 끝내기: 구간이 필지 수개이고 돌아오는 시각이 없다", () => {
    const plan = planRoute(settings({ endMode: "lastParcel" }), parcels);
    expect(plan.legs).toHaveLength(4);
    expect(plan.legs.at(-1)?.to).not.toBe("origin");
    expect(plan.returnMinutes).toBeUndefined();
  });

  it("구간은 서로 이어진다 (앞 구간의 도착지 = 다음 구간의 출발지)", () => {
    const plan = planRoute(settings(), parcels);
    for (let i = 1; i < plan.legs.length; i++) expect(plan.legs[i].from).toBe(plan.legs[i - 1].to);
  });

  it("총 소요 시간 = 이동 시간 + 조사 시간(필지당 시간 × 필지 수)", () => {
    const plan = planRoute(settings({ inspectMinutes: 15 }), parcels);
    expect(plan.inspectMinutes).toBe(60);
    expect(plan.travelMinutes).toBe(plan.legs.reduce((s, l) => s + l.minutes, 0));
    expect(plan.totalMinutes).toBe(plan.travelMinutes + 60);
  });

  it("조사 시간을 0으로 하면 이동 시간만 남는다", () => {
    const plan = planRoute(settings({ inspectMinutes: 0 }), parcels);
    expect(plan.inspectMinutes).toBe(0);
    expect(plan.totalMinutes).toBe(plan.travelMinutes);
  });

  it("도착 시각은 출발 시각 + 앞 구간 이동 + 앞 필지 조사 시간이 쌓인다", () => {
    const plan = planRoute(settings({ departTime: "09:00", inspectMinutes: 10 }), parcels);
    expect(plan.arrivalMinutes[0]).toBe(540 + plan.legs[0].minutes);
    expect(plan.arrivalMinutes[1]).toBe(plan.arrivalMinutes[0] + 10 + plan.legs[1].minutes);
    const last = plan.arrivalMinutes.at(-1)!;
    expect(plan.returnMinutes).toBe(last + 10 + plan.legs.at(-1)!.minutes);
  });

  it("모든 구간은 추정값이고, 도보 구간·도로 끝 표시는 아직 없다", () => {
    const plan = planRoute(settings(), parcels);
    expect(plan.estimated).toBe(true);
    expect(plan.legs.every((l) => l.estimated && !l.walkFallback && !l.roadEndWalk)).toBe(true);
  });

  it("이동 수단이 느릴수록 총 이동 시간이 길다", () => {
    const car = planRoute(settings({ mode: "car" }), parcels).travelMinutes;
    const transit = planRoute(settings({ mode: "transit" }), parcels).travelMinutes;
    const walk = planRoute(settings({ mode: "walk" }), parcels).travelMinutes;
    expect(car).toBeLessThan(transit);
    expect(transit).toBeLessThan(walk);
  });

  it("필지 하나, 필지 없음도 처리한다", () => {
    expect(planRoute(settings(), [parcel(1, 0.02)]).orderIds).toEqual(["p-1"]);
    const none = planRoute(settings(), []);
    expect(none.orderIds).toEqual([]);
    expect(none.legs).toEqual([]);
    expect(none.totalMinutes).toBe(0);
  });

  it("위치가 없는 필지는 계산에서 제외한다", () => {
    const plan = planRoute(settings(), [parcel(1, 0.01), { id: "p-2", address: "x", rowNumbers: [2], needsCheck: true }]);
    expect(plan.orderIds).toEqual(["p-1"]);
  });

  it("30필지도 모두 한 번씩 방문하고 2.5초 안에 끝난다", () => {
    const many = Array.from({ length: 30 }, (_, i) => parcel(i + 1, ((i * 7) % 30) * 0.004, ((i * 11) % 30) * 0.004));
    const t = performance.now();
    const plan = planRoute(settings(), many);
    expect(performance.now() - t).toBeLessThan(2500);
    expect(new Set(plan.orderIds).size).toBe(30);
    expect(plan.exact).toBe(false);
  });

  it("12필지까지는 최단 보장(exact)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => parcel(i + 1, ((i * 5) % 12) * 0.006, ((i * 7) % 12) * 0.006));
    expect(planRoute(settings(), twelve).exact).toBe(true);
  });
});

describe("planRoute — 길찾기 시간표를 넣었을 때", () => {
  // 지점 0=출발지, 1~3=필지. 1→2→3 순서로 가는 길은 빠르고(각 5분), 반대 방향이나 다른 순서는 느리다(각 30분)
  const three = [parcel(1, 0.01), parcel(2, 0.02), parcel(3, 0.03)];
  const make = (fast: [number, number][], estimatedPairs: [number, number][] = []) => {
    const minutes: number[][] = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b): number => (a === b ? 0 : 30)));
    const km: number[][] = Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b): number => (a === b ? 0 : 9.9)));
    const estimated = Array.from({ length: 4 }, () => new Array<boolean>(4).fill(false));
    for (const [a, b] of fast) {
      minutes[a][b] = 5;
      km[a][b] = 1.5;
    }
    for (const [a, b] of estimatedPairs) estimated[a][b] = true;
    return { minutes, km, estimated };
  };
  const FAST_CHAIN: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];

  it("시간표에서 가장 빠른 순서를 고른다 (직선거리로는 정해지지 않는 순서)", () => {
    // 직선거리로는 가까운 1,2,3 순서지만, 시간표에서는 3→1→2 로 가는 길만 빠르다고 만든다
    const table = make([[0, 3], [3, 1], [1, 2], [2, 0]]);
    const plan = planRoute(settings({ endMode: "return" }), three, table);
    expect(plan.orderIds).toEqual(["p-3", "p-1", "p-2"]);
    expect(plan.travelMinutes).toBe(20);
  });

  it("표의 거리·시간은 시간표 값이고, 추정이 아닌 구간에는 추정값 표시가 없다", () => {
    const plan = planRoute(settings(), three, make(FAST_CHAIN));
    expect(plan.legs.map((l) => [l.minutes, l.distanceKm, l.estimated])).toEqual([
      [5, 1.5, false],
      [5, 1.5, false],
      [5, 1.5, false],
      [5, 1.5, false],
    ]);
    expect(plan.estimated).toBe(false);
    expect(plan.estimatedLegCount).toBe(0);
  });

  it("추정으로 채운 구간만 추정값으로 표시한다", () => {
    const plan = planRoute(settings(), three, make(FAST_CHAIN, [[1, 2]]));
    expect(plan.legs.map((l) => l.estimated)).toEqual([false, true, false, false]);
    expect(plan.estimated).toBe(true);
    expect(plan.estimatedLegCount).toBe(1);
  });

  it("시간표를 주지 않으면 전부 추정값이다 (길찾기 실패 시 대체)", () => {
    const plan = planRoute(settings(), three);
    expect(plan.estimatedLegCount).toBe(plan.legs.length);
  });

  it("시간표 크기가 지점 수와 다르면 무시하고 추정 시간표를 쓴다", () => {
    const wrong = { minutes: [[0, 1], [1, 0]], km: [[0, 1], [1, 0]], estimated: [[false, false], [false, false]] };
    const plan = planRoute(settings(), three, wrong);
    expect(plan.estimatedLegCount).toBe(plan.legs.length);
    expect(new Set(plan.orderIds).size).toBe(3);
  });

  it("오가는 시간이 다른 시간표(한 방향이 느림)도 반영한다", () => {
    const minutes = [
      [0, 5, 50],
      [5, 0, 5],
      [50, 5, 0],
    ];
    const km = minutes.map((r) => r.map((v) => v / 2));
    const estimated = minutes.map((r) => r.map(() => false));
    const two = [parcel(1, 0.01), parcel(2, 0.02)];
    const plan = planRoute(settings({ endMode: "lastParcel" }), two, { minutes, km, estimated });
    expect(plan.orderIds).toEqual(["p-1", "p-2"]);
    expect(plan.travelMinutes).toBe(10);
  });

  it("routePoints는 출발지 다음에 위치가 있는 필지를 순서대로 담는다", () => {
    const withUnlocated = [parcel(1, 0.01), { id: "p-x", address: "x", rowNumbers: [9], needsCheck: true } as Parcel, parcel(2, 0.02)];
    const pts = routePoints(settings(), withUnlocated);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual(ORIGIN);
    expect(pts[2]).toEqual(withUnlocated[2].coord);
  });
});

describe("repricePlan — 정해진 순서에 실제 구간 값 반영", () => {
  const four = [parcel(1, 0.01), parcel(2, 0.02), parcel(3, 0.03), parcel(4, 0.04)];
  const base = (over: Partial<RouteSettings> = {}) => {
    const s = settings({ mode: "walk", endMode: "return", inspectMinutes: 10, ...over });
    return { s, plan: planRoute(s, four) };
  };

  it("순서는 그대로 두고, 얻은 구간만 실제 값으로 바뀌고 추정값 표시가 사라진다", () => {
    const { s, plan } = base();
    const actuals = plan.legs.map((_, i) => (i === 1 ? ({ ok: false } as const) : ({ ok: true, minutes: 20 + i, km: 1.5 + i } as const)));
    const next = repricePlan(s, plan, actuals);
    expect(next.orderIds).toEqual(plan.orderIds);
    expect(next.legs.map((l) => l.estimated)).toEqual([false, true, false, false, false]);
    expect(next.legs[0]).toMatchObject({ minutes: 20, distanceKm: 1.5 });
    expect(next.legs[1]).toEqual(plan.legs[1]); // 못 얻은 구간은 기존 값 유지
    expect(next.estimatedLegCount).toBe(1);
    expect(next.estimated).toBe(true);
  });

  it("합계와 도착 시각을 실제 값으로 다시 계산한다", () => {
    const { s, plan } = base({ departTime: "09:00" });
    const next = repricePlan(s, plan, plan.legs.map(() => ({ ok: true, minutes: 30, km: 2 })));
    expect(next.travelMinutes).toBe(150); // 구간 5개 × 30분
    expect(next.inspectMinutes).toBe(40);
    expect(next.totalMinutes).toBe(190);
    expect(next.arrivalMinutes[0]).toBe(540 + 30);
    expect(next.arrivalMinutes[1]).toBe(540 + 30 + 10 + 30);
    expect(next.returnMinutes).toBe(540 + 190);
    expect(next.estimated).toBe(false);
  });

  it("모든 구간을 얻지 못하면 계획이 그대로이다", () => {
    const { s, plan } = base();
    const next = repricePlan(s, plan, plan.legs.map(() => ({ ok: false })));
    expect(next.legs).toEqual(plan.legs);
    expect(next.totalMinutes).toBe(plan.totalMinutes);
  });

  it("결과 개수가 구간 수와 다르면 계획을 그대로 돌려준다", () => {
    const { s, plan } = base();
    expect(repricePlan(s, plan, [{ ok: true, minutes: 1, km: 1 }])).toBe(plan);
  });

  it("마지막 필지에서 끝내기도 같은 규칙", () => {
    const { s, plan } = base({ endMode: "lastParcel" });
    expect(plan.legs).toHaveLength(4);
    const next = repricePlan(s, plan, plan.legs.map(() => ({ ok: true, minutes: 12, km: 1 })));
    expect(next.travelMinutes).toBe(48);
    expect(next.returnMinutes).toBeUndefined();
  });

  it("대중교통: 환승 횟수와 도보 구간 표시가 구간에 담긴다", () => {
    const { s, plan } = base({ mode: "transit", endMode: "lastParcel" });
    const next = repricePlan(s, plan, [
      { ok: true, minutes: 30, km: 8, transfers: 2 },
      { ok: true, minutes: 4, km: 0.3, transfers: 0, walkFallback: true },
      { ok: false },
      { ok: true, minutes: 20, km: 5, transfers: 1 },
    ]);
    expect(next.legs.map((l) => l.transfers)).toEqual([2, 0, undefined, 1]);
    expect(next.legs.map((l) => l.walkFallback)).toEqual([false, true, false, false]);
    expect(next.legs.map((l) => l.estimated)).toEqual([false, false, true, false]);
  });

  it("legPoints는 구간 i = points[i]→points[i+1]이 되도록 지점을 늘어놓는다", () => {
    const { s, plan } = base();
    const pts = legPoints(s, plan, four);
    expect(pts).toHaveLength(plan.legs.length + 1);
    expect(pts[0]).toEqual(ORIGIN);
    expect(pts.at(-1)).toEqual(ORIGIN); // 복귀 설정이면 출발지로 끝남
    plan.orderIds.forEach((id, i) => expect(pts[i + 1]).toEqual(four.find((p) => p.id === id)!.coord));
    expect(legPoints(s, planRoute(s, []), [])).toEqual([]);
  });
});

describe("자차 — 도로에서 먼 필지 (도로 끝에서 도보 이동 필요)", () => {
  // 지점 0=출발지, 1~3=필지. 시간표는 모든 구간 10분
  const three = [parcel(1, 0.01), parcel(2, 0.02), parcel(3, 0.03)];
  const table = (extra: Partial<Timetable> = {}): Timetable => ({
    minutes: Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b): number => (a === b ? 0 : 10))),
    km: Array.from({ length: 4 }, (_, a) => Array.from({ length: 4 }, (_, b): number => (a === b ? 0 : 3))),
    estimated: Array.from({ length: 4 }, () => new Array<boolean>(4).fill(false)),
    ...extra,
  });
  const carSettings = (over: Partial<RouteSettings> = {}) => settings({ mode: "car", endMode: "return", ...over });

  it("도로 끝으로 옮겨 계산한 필지로 가는 구간에 표시와 거리가 붙는다 (다른 구간에는 없음)", () => {
    const plan = planRoute(carSettings(), three, table({ roadEnds: [{ index: 2, coord: ORIGIN, meters: 640 }] }));
    const idx = plan.orderIds.indexOf("p-2"); // 필지 2(지점 2)에 도착하는 구간 = legs[방문 순번]
    plan.legs.forEach((leg, i) => {
      if (i === idx) expect(leg).toMatchObject({ roadEndWalk: true, roadEndMeters: 640, to: "p-2" });
      else expect(leg.roadEndWalk).toBe(false);
    });
  });

  it("출발지로 돌아오는 구간에는 표시하지 않는다", () => {
    const plan = planRoute(carSettings(), three, table({ roadEnds: [{ index: 1, coord: ORIGIN, meters: 500 }] }));
    expect(plan.legs.at(-1)?.to).toBe("origin");
    expect(plan.legs.at(-1)?.roadEndWalk).toBe(false);
  });

  it("가까운 도로를 못 찾은 필지(noRoad)는 표시만 붙고 거리는 모른다", () => {
    const estimated = Array.from({ length: 4 }, () => new Array<boolean>(4).fill(false));
    for (let a = 0; a < 4; a++) estimated[a][3] = a !== 3; // 3번 필지로 가는 구간은 추정값
    const plan = planRoute(carSettings(), three, table({ noRoad: [3], estimated }));
    const leg = plan.legs.find((l) => l.to === "p-3")!;
    expect(leg).toMatchObject({ roadEndWalk: true, estimated: true });
    expect(leg.roadEndMeters).toBeUndefined();
  });

  it("repricePlan: 확정 구간의 도로 끝 거리가 100m를 넘으면 표시하고, 이하이면 표시하지 않는다", () => {
    const s = carSettings({ endMode: "lastParcel" });
    const plan = planRoute(s, three, table());
    const next = repricePlan(s, plan, [
      { ok: true, minutes: 10, km: 3, endGapMeters: 450 },
      { ok: true, minutes: 10, km: 3, endGapMeters: 100 },
      { ok: true, minutes: 10, km: 3, endGapMeters: 5 },
    ]);
    expect(next.legs.map((l) => l.roadEndWalk)).toEqual([true, false, false]);
    expect(next.legs[0].roadEndMeters).toBe(450);
    expect(next.legs[1].roadEndMeters).toBeUndefined();
  });

  it("repricePlan: 시간표 단계에서 이미 옮겨 계산한 필지는 그 거리를 유지하고 덮어쓰지 않는다", () => {
    const s = carSettings({ endMode: "lastParcel" });
    const plan = planRoute(s, three, table({ roadEnds: [{ index: 1, coord: ORIGIN, meters: 800 }] }));
    const next = repricePlan(s, plan, plan.legs.map(() => ({ ok: true as const, minutes: 10, km: 3, endGapMeters: 3 })));
    const leg = next.legs.find((l) => l.to === "p-1")!;
    expect(leg).toMatchObject({ roadEndWalk: true, roadEndMeters: 800 });
  });

  it("repricePlan: 출발지로 돌아오는 구간은 도로 끝 거리가 멀어도 표시하지 않는다", () => {
    const s = carSettings();
    const plan = planRoute(s, three, table());
    const next = repricePlan(s, plan, plan.legs.map(() => ({ ok: true as const, minutes: 10, km: 3, endGapMeters: 900 })));
    expect(next.legs.at(-1)?.roadEndWalk).toBe(false);
    expect(next.legs.slice(0, -1).every((l) => l.roadEndWalk)).toBe(true);
  });

  it("roadEndOverrides: 시간표의 지점 번호를 필지 id로 바꿔 도로 끝 좌표를 모은다", () => {
    const end = { lat: 37.6, lng: 127.1 };
    const map = roadEndOverrides(carSettings(), three, table({ roadEnds: [{ index: 2, coord: end, meters: 600 }] }));
    expect([...map.entries()]).toEqual([["p-2", end]]);
    expect(roadEndOverrides(carSettings(), three, undefined).size).toBe(0);
  });

  it("legPoints: 덮어쓴 좌표(도로 끝)를 해당 필지에 쓴다", () => {
    const end = { lat: 37.6, lng: 127.1 };
    const s = carSettings({ endMode: "lastParcel" });
    const plan = planRoute(s, three, table());
    const pts = legPoints(s, plan, three, new Map([["p-2", end]]));
    const at = plan.orderIds.indexOf("p-2") + 1;
    expect(pts[at]).toEqual(end);
    expect(pts[0]).toEqual(ORIGIN);
  });
});

describe("routeDrawing — 지도에 그릴 경로", () => {
  const four = [parcel(1, 0.01), parcel(2, 0.02), parcel(3, 0.03), parcel(4, 0.04)];

  it("방문 순번은 1부터 순서대로 필지에 붙는다", () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = planRoute(s, four);
    const d = routeDrawing(s, plan, four);
    expect(Object.keys(d.order).sort()).toEqual(["p-1", "p-2", "p-3", "p-4"]);
    plan.orderIds.forEach((id, i) => expect(d.order[id]).toBe(i + 1));
  });

  it("선은 구간마다 하나이고, 앞 선의 끝이 다음 선의 시작이다 (출발지에서 시작)", () => {
    const s = settings({ endMode: "lastParcel" });
    const d = routeDrawing(s, planRoute(s, four), four);
    expect(d.segments).toHaveLength(4);
    expect(d.segments[0].from).toEqual(ORIGIN);
    for (let i = 1; i < d.segments.length; i++) expect(d.segments[i].from).toEqual(d.segments[i - 1].to);
  });

  it("출발지로 돌아오기: 마지막 선이 출발지로 돌아온다", () => {
    const s = settings({ endMode: "return" });
    const d = routeDrawing(s, planRoute(s, four), four);
    expect(d.segments).toHaveLength(5);
    expect(d.segments.at(-1)?.to).toEqual(ORIGIN);
  });

  it("추정값 구간만 estimated로 표시된다 (점선 대상)", () => {
    const s = settings({ mode: "walk", endMode: "lastParcel" });
    const plan = planRoute(s, four);
    const next = repricePlan(s, plan, [{ ok: true, minutes: 5, km: 1 }, { ok: false }, { ok: true, minutes: 5, km: 1 }, { ok: false }]);
    expect(routeDrawing(s, next, four).segments.map((x) => x.estimated)).toEqual([false, true, false, true]);
  });

  it("모든 지점(경로가 지나는 곳)이 points에 담긴다", () => {
    const s = settings({ endMode: "return" });
    const d = routeDrawing(s, planRoute(s, four), four);
    expect(d.points).toHaveLength(6); // 출발지, 필지 4개, 다시 출발지
  });

  it("필지가 없으면 그릴 것이 없다", () => {
    const s = settings();
    const d = routeDrawing(s, planRoute(s, []), []);
    expect(d).toEqual({ segments: [], order: {}, points: [] });
  });
});

describe("시각·시간 표기", () => {
  it("parseClock / formatClock", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(formatClock(570)).toBe("09:30");
    expect(formatClock(1450)).toBe("다음날 00:10");
  });

  it("formatDuration", () => {
    expect(formatDuration(45)).toBe("45분");
    expect(formatDuration(120)).toBe("2시간");
    expect(formatDuration(125)).toBe("2시간 5분");
  });
});
