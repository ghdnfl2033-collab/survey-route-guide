import { describe, expect, it } from "vitest";
import { pruneSelection, selectFirst, toggleSelection } from "@/lib/core/selection";
import { MAX_PARCELS_PER_ROUTE, type Parcel } from "@/lib/core/types";

const located = (n: number): Parcel => ({ id: `p-${n}`, address: `주소${n}`, rowNumbers: [n], coord: { lat: 37, lng: 127 }, needsCheck: false });
const unlocated = (n: number): Parcel => ({ id: `p-${n}`, address: `주소${n}`, rowNumbers: [n], needsCheck: true });
const many = (count: number) => Array.from({ length: count }, (_, i) => located(i + 1));

describe("toggleSelection — 하나씩 선택·해제", () => {
  const parcels = [located(1), located(2), unlocated(3)];

  it("선택하면 추가되고 다시 누르면 해제된다", () => {
    const on = toggleSelection([], "p-1", parcels);
    expect(on).toEqual({ selected: ["p-1"] });
    expect(toggleSelection(on.selected, "p-1", parcels)).toEqual({ selected: [] });
  });

  it("고른 순서를 유지한다", () => {
    const a = toggleSelection([], "p-2", parcels).selected;
    expect(toggleSelection(a, "p-1", parcels).selected).toEqual(["p-2", "p-1"]);
  });

  it("위치 없는 필지는 고를 수 없다", () => {
    expect(toggleSelection([], "p-3", parcels)).toEqual({ selected: [], blocked: "noLocation" });
  });

  it("없는 필지 id는 막는다", () => {
    expect(toggleSelection([], "p-999", parcels)).toEqual({ selected: [], blocked: "unknown" });
  });

  it("30개가 차 있으면 31번째는 막는다", () => {
    const all = many(31);
    const thirty = all.slice(0, MAX_PARCELS_PER_ROUTE).map((p) => p.id);
    const r = toggleSelection(thirty, "p-31", all);
    expect(r.blocked).toBe("limit");
    expect(r.selected).toHaveLength(30);
  });

  it("30개가 차 있어도 해제는 할 수 있고, 해제하면 다시 고를 수 있다", () => {
    const all = many(31);
    const thirty = all.slice(0, 30).map((p) => p.id);
    const freed = toggleSelection(thirty, "p-1", all).selected;
    expect(freed).toHaveLength(29);
    expect(toggleSelection(freed, "p-31", all).selected).toHaveLength(30);
  });
});

describe("selectFirst — 전체선택", () => {
  it("30개 이하면 위치 있는 필지를 모두 선택한다 (위치 없는 필지는 제외)", () => {
    const r = selectFirst([located(1), unlocated(2), located(3)]);
    expect(r).toEqual({ selected: ["p-1", "p-3"], truncated: false });
  });

  it("30개를 넘으면 앞에서부터 30개만 선택하고 잘렸다고 알려 준다", () => {
    const r = selectFirst(many(45));
    expect(r.selected).toHaveLength(30);
    expect(r.selected[0]).toBe("p-1");
    expect(r.selected[29]).toBe("p-30");
    expect(r.truncated).toBe(true);
  });

  it("딱 30개면 잘리지 않는다", () => {
    expect(selectFirst(many(30)).truncated).toBe(false);
  });
});

describe("pruneSelection", () => {
  it("없어졌거나 위치가 없는 필지의 선택을 걸러낸다", () => {
    expect(pruneSelection(["p-1", "p-2", "p-9"], [located(1), unlocated(2)])).toEqual(["p-1"]);
  });
});
