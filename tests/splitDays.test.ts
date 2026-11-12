import { describe, expect, it } from "vitest";
import { addDaysToDate, PARCELS_PER_DAY, planRoute, repricePlan, splitPlanByDay } from "@/lib/core/route";
import type { Parcel, RouteSettings } from "@/lib/core/types";

const ORIGIN = { lat: 37.5665, lng: 126.978 };
const parcel = (n: number): Parcel => ({
  id: `p-${n}`,
  address: `주소${n}`,
  rowNumbers: [n],
  coord: { lat: ORIGIN.lat + n * 0.004, lng: ORIGIN.lng + (n % 3) * 0.004 },
  needsCheck: false,
});
const parcels = (n: number) => Array.from({ length: n }, (_, i) => parcel(i + 1));
const settings = (over: Partial<RouteSettings> = {}): RouteSettings => ({
  origin: { address: "출발", coord: ORIGIN },
  date: "2026-11-30",
  departTime: "09:00",
  endMode: "return",
  mode: "walk",
  inspectMinutes: 10,
  ...over,
});
/** 모든 구간에 실제 길찾기 값(30분, 3km)을 넣은 전체 동선 */
function fullPlan(s: RouteSettings, list: Parcel[]) {
  const base = planRoute(s, list);
  return repricePlan(s, base, base.legs.map(() => ({ ok: true as const, minutes: 30, km: 3 })));
}

describe("splitPlanByDay — 하루 18필지씩 나누기", () => {
  it("하루 기준은 18필지다", () => {
    expect(PARCELS_PER_DAY).toBe(18);
  });

  it("30필지는 18곳 + 12곳, 두 날로 나뉘고 모든 필지가 정확히 한 번씩 들어간다", () => {
    const s = settings();
    const list = parcels(30);
    const plan = fullPlan(s, list);
    const days = splitPlanByDay(s, plan, list);
    expect(days.map((d) => d.plan.orderIds.length)).toEqual([18, 12]);
    expect(days.flatMap((d) => d.plan.orderIds)).toEqual(plan.orderIds); // 전체 순서를 그대로 끊는다
    expect(new Set(days.flatMap((d) => d.plan.orderIds)).size).toBe(30);
  });

  it("18곳 이하이면 하루짜리 한 개다", () => {
    const s = settings();
    const list = parcels(18);
    expect(splitPlanByDay(s, fullPlan(s, list), list)).toHaveLength(1);
    expect(splitPlanByDay(s, fullPlan(s, parcels(5)), parcels(5))).toHaveLength(1);
  });

  it("하루마다 출발지에서 시작하고 복귀 설정이면 출발지로 돌아온다", () => {
    const s = settings();
    const list = parcels(30);
    const days = splitPlanByDay(s, fullPlan(s, list), list);
    for (const d of days) {
      const legs = d.plan.legs;
      expect(legs[0].from).toBe("origin");
      expect(legs.at(-1)!.to).toBe("origin");
      expect(legs).toHaveLength(d.plan.orderIds.length + 1);
      expect(d.plan.returnMinutes).toBeDefined();
    }
  });

  it("마지막 필지에서 끝내기 설정이면 복귀 구간이 없다", () => {
    const s = settings({ endMode: "lastParcel" });
    const list = parcels(30);
    const days = splitPlanByDay(s, fullPlan(s, list), list);
    days.forEach((d) => expect(d.plan.legs).toHaveLength(d.plan.orderIds.length));
  });

  it("끊는 자리에서 새로 생긴 구간만 추정값이고, 나머지는 기존 길찾기 값을 쓴다", () => {
    const s = settings();
    const list = parcels(30);
    const days = splitPlanByDay(s, fullPlan(s, list), list);
    // 1일차: 출발→첫 필지는 그대로, 18번째→출발(복귀)만 새 구간
    expect(days[0].freshLegIndexes).toEqual([18]);
    expect(days[0].plan.legs[0].estimated).toBe(false);
    expect(days[0].plan.legs[18].estimated).toBe(true);
    // 2일차: 출발→19번째 필지만 새 구간, 마지막 복귀는 기존 값
    expect(days[1].freshLegIndexes).toEqual([0]);
    expect(days[1].plan.legs.at(-1)!.estimated).toBe(false);
  });

  it("새 구간의 실제 값을 받으면 그 구간만 바뀌고 일차별 시각·합계가 다시 계산된다", () => {
    const s = settings();
    const list = parcels(30);
    const days = splitPlanByDay(s, fullPlan(s, list), list);
    const d = days[1];
    const actuals = d.plan.legs.map((_, i) => (d.freshLegIndexes.includes(i) ? { ok: true as const, minutes: 12, km: 1 } : { ok: false as const }));
    const done = repricePlan(s, d.plan, actuals);
    expect(done.estimatedLegCount).toBe(0);
    expect(done.legs[0].minutes).toBe(12);
    expect(done.arrivalMinutes[0]).toBe(540 + 12);
    expect(done.totalMinutes).toBe(done.travelMinutes + 12 * 10);
  });

  it("하루 기준을 바꿔 나눌 수도 있다 (7곳씩 → 7+7+7+7+2)", () => {
    const s = settings();
    const list = parcels(30);
    const days = splitPlanByDay(s, fullPlan(s, list), list, 7);
    expect(days.map((d) => d.plan.orderIds.length)).toEqual([7, 7, 7, 7, 2]);
  });

  it("필지가 없으면 빈 목록이다", () => {
    const s = settings();
    expect(splitPlanByDay(s, planRoute(s, []), [])).toEqual([]);
  });
});

describe("addDaysToDate", () => {
  it("월·연말을 넘겨 날짜를 더한다", () => {
    expect(addDaysToDate("2026-11-13", 1)).toBe("2026-11-14");
    expect(addDaysToDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDate("2026-11-13", 0)).toBe("2026-11-13");
  });
});
