import { describe, expect, it } from "vitest";
import { moveInOrder, planRoute, repricePlan, reorderPlan } from "@/lib/core/route";
import type { Parcel, RouteSettings } from "@/lib/core/types";

const ORIGIN = { lat: 37.5665, lng: 126.978 };
const parcel = (n: number, dLat: number): Parcel => ({
  id: `p-${n}`,
  address: `주소${n}`,
  rowNumbers: [n],
  coord: { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng },
  needsCheck: false,
});
const settings = (over: Partial<RouteSettings> = {}): RouteSettings => ({
  origin: { address: "출발", coord: ORIGIN },
  date: "2027-03-15",
  departTime: "09:00",
  endMode: "return",
  mode: "walk",
  inspectMinutes: 10,
  ...over,
});
const four = [parcel(1, 0.01), parcel(2, 0.02), parcel(3, 0.03), parcel(4, 0.04)];

/** 실제 길찾기 값을 받은 것처럼 모든 구간을 77분 8km로 만든다 */
function priced(s: RouteSettings) {
  const base = planRoute(s, four);
  return repricePlan(s, base, base.legs.map(() => ({ ok: true as const, minutes: 77, km: 8 })));
}

describe("moveInOrder", () => {
  it("앞에서 뒤로, 뒤에서 앞으로 옮긴다", () => {
    expect(moveInOrder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInOrder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("범위를 벗어나거나 같은 자리면 그대로다 (원본은 건드리지 않는다)", () => {
    const orig = ["a", "b"];
    expect(moveInOrder(orig, 0, 5)).toEqual(["a", "b"]);
    expect(moveInOrder(orig, 1, 1)).toEqual(["a", "b"]);
    expect(moveInOrder(orig, -1, 0)).toEqual(["a", "b"]);
    expect(orig).toEqual(["a", "b"]);
  });
});

describe("reorderPlan — 순서 직접 바꾸기", () => {
  it("모든 필지를 한 번씩 담은 새 순서로 계획이 바뀌고, manual 표시가 붙는다", () => {
    const s = settings();
    const plan = priced(s);
    const next = moveInOrder(plan.orderIds, 0, 2);
    const r = reorderPlan(s, plan, four, next);
    expect(r.plan.orderIds).toEqual(next);
    expect(r.plan.manual).toBe(true);
    expect(r.plan.exact).toBe(false);
    expect(r.plan.legs.map((l) => l.from).slice(1)).toEqual(next);
  });

  it("앞뒤가 그대로인 구간은 기존 길찾기 값을 유지하고, 새 구간만 추정값이 된다", () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = priced(s);
    const [a, b, c, d] = plan.orderIds;
    const r = reorderPlan(s, plan, four, [a, c, b, d]); // b와 c를 맞바꿈: a→c, c→b, b→d가 새 구간
    expect(r.freshLegIndexes).toEqual([1, 2, 3]);
    expect(r.plan.legs[0].estimated).toBe(false); // 출발→a는 그대로
    expect(r.plan.legs[0].minutes).toBe(77);
    r.freshLegIndexes.forEach((i) => expect(r.plan.legs[i].estimated).toBe(true));
  });

  it("끝에서 끝으로 한 칸 옮기면 바뀌지 않은 구간은 다시 조회하지 않는다", () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = priced(s);
    const [a, b, c, d] = plan.orderIds;
    const r = reorderPlan(s, plan, four, [a, b, d, c]);
    expect(r.freshLegIndexes).toEqual([3, 2].sort());
    expect(r.plan.legs[0].estimated).toBe(false);
    expect(r.plan.legs[1].estimated).toBe(false);
  });

  it("시각과 합계를 다시 계산한다 (조사 시간 포함, 복귀 구간 포함)", () => {
    const s = settings();
    const plan = priced(s);
    const r = reorderPlan(s, plan, four, moveInOrder(plan.orderIds, 0, 3));
    const p = r.plan;
    expect(p.legs).toHaveLength(5); // 출발→4곳→복귀
    expect(p.legs[p.legs.length - 1].to).toBe("origin");
    expect(p.arrivalMinutes[0]).toBe(540 + p.legs[0].minutes);
    expect(p.arrivalMinutes[1]).toBe(p.arrivalMinutes[0] + 10 + p.legs[1].minutes);
    expect(p.totalMinutes).toBe(p.travelMinutes + 40);
    expect(p.returnMinutes).toBe(p.arrivalMinutes[3] + 10 + p.legs[4].minutes);
  });

  it("새 구간의 실제 값을 받으면 repricePlan으로 그 구간만 추정값에서 벗어난다", () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = priced(s);
    const r = reorderPlan(s, plan, four, moveInOrder(plan.orderIds, 0, 3));
    const actuals = r.plan.legs.map((_, i) => (r.freshLegIndexes.includes(i) ? { ok: true as const, minutes: 5, km: 1 } : { ok: false as const }));
    const done = repricePlan(s, r.plan, actuals);
    expect(done.estimatedLegCount).toBe(0);
    expect(done.manual).toBe(true); // 값을 새로 받아도 직접 바꾼 순서라는 표시는 유지
    r.freshLegIndexes.forEach((i) => expect(done.legs[i].minutes).toBe(5));
  });

  it("도로 끝에서 걸어야 하는 필지는 순서를 바꿔도 표시가 남는다", () => {
    const s = settings({ mode: "car", endMode: "lastParcel" });
    const base = planRoute(s, four);
    const plan = repricePlan(
      s,
      base,
      base.legs.map((l) => ({ ok: true as const, minutes: 10, km: 2, endGapMeters: l.to === "p-3" ? 400 : 3 })),
    );
    const r = reorderPlan(s, plan, four, moveInOrder(plan.orderIds, 0, 3));
    const leg = r.plan.legs.find((l) => l.to === "p-3")!;
    expect(leg.roadEndWalk).toBe(true);
    expect(leg.roadEndMeters).toBe(400);
  });

  it("필지가 빠지거나 겹치거나 모르는 id가 있으면 계획을 바꾸지 않는다", () => {
    const s = settings();
    const plan = priced(s);
    const [a, b, c, d] = plan.orderIds;
    for (const bad of [[a, b, c], [a, a, c, d], [a, b, c, "x"], [a, b, c, d, "p-9"]]) {
      const r = reorderPlan(s, plan, four, bad);
      expect(r.plan).toBe(plan);
      expect(r.freshLegIndexes).toEqual([]);
    }
  });

  it("순서가 같으면 그대로다", () => {
    const s = settings();
    const plan = priced(s);
    expect(reorderPlan(s, plan, four, [...plan.orderIds]).plan).toBe(plan);
  });
});
