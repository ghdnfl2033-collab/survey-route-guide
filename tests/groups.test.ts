import { describe, expect, it } from "vitest";
import {
  addGroup,
  applyGroup,
  checkGroupName,
  deleteGroup,
  MAX_GROUPS,
  parseStoredGroups,
  renameGroup,
  type ParcelGroup,
} from "@/lib/core/groups";
import type { Parcel } from "@/lib/core/types";

const parcel = (n: number, withCoord = true): Parcel => ({
  id: `p-${n}`,
  address: `서울 종로구 ${n}번지`,
  rowNumbers: [n],
  ...(withCoord ? { coord: { lat: 37.5 + n / 1000, lng: 127 } } : {}),
  needsCheck: !withCoord,
});
const NOW = new Date("2026-11-13T00:00:00Z");
const ok = (r: ReturnType<typeof addGroup>) => {
  if (!r.ok) throw new Error(r.message);
  return r.groups;
};

describe("묶음 만들기", () => {
  it("이름 앞뒤·겹친 공백을 정리하고 주소와 좌표만 저장한다", () => {
    const groups = ok(addGroup([], "  청운동  1차  ", [parcel(1), parcel(2)], NOW));
    expect(groups[0].name).toBe("청운동 1차");
    expect(groups[0].parcels).toEqual([
      { address: "서울 종로구 1번지", lat: 37.501, lng: 127 },
      { address: "서울 종로구 2번지", lat: 37.502, lng: 127 },
    ]);
    // 조사 기록·줄 번호·id 같은 다른 정보는 묶음 안에 없다
    expect(JSON.stringify(groups[0].parcels)).not.toMatch(/rowNumbers|needsCheck|p-1|memo/);
    expect(groups[0].savedAt).toBe(NOW.toISOString());
  });

  it("빈 이름·너무 긴 이름·같은 이름은 거절한다", () => {
    expect(addGroup([], "   ", [parcel(1)]).ok).toBe(false);
    expect(addGroup([], "가".repeat(31), [parcel(1)]).ok).toBe(false);
    const groups = ok(addGroup([], "A", [parcel(1)], NOW));
    const dup = addGroup(groups, "A", [parcel(2)], NOW);
    expect(dup.ok).toBe(false);
  });

  it("고른 필지가 없거나 위치가 없는 필지뿐이면 거절한다", () => {
    expect(addGroup([], "A", []).ok).toBe(false);
    expect(addGroup([], "A", [parcel(1, false)]).ok).toBe(false);
  });

  it("위치 없는 필지는 빼고 저장한다", () => {
    const groups = ok(addGroup([], "A", [parcel(1), parcel(2, false)], NOW));
    expect(groups[0].parcels).toHaveLength(1);
  });

  it("30필지까지는 저장하고 31필지는 거절한다", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => parcel(i + 1));
    expect(addGroup([], "A", many(30)).ok).toBe(true);
    expect(addGroup([], "A", many(31)).ok).toBe(false);
  });

  it("20개가 차면 오래된 묶음을 지우라고 안내하고 저장하지 않는다", () => {
    let groups: ParcelGroup[] = [];
    for (let i = 0; i < MAX_GROUPS; i++) groups = ok(addGroup(groups, `묶음${i}`, [parcel(1)], NOW));
    expect(groups).toHaveLength(20);
    const r = addGroup(groups, "하나 더", [parcel(1)], NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("오래된 묶음을 지운");
  });

  it("묶음 id는 서로 다르다", () => {
    let groups: ParcelGroup[] = [];
    groups = ok(addGroup(groups, "A", [parcel(1)], NOW));
    groups = ok(addGroup(groups, "B", [parcel(1)], NOW));
    expect(groups[0].id).not.toBe(groups[1].id);
  });
});

describe("이름 바꾸기·삭제", () => {
  const base = ok(addGroup(ok(addGroup([], "A", [parcel(1)], NOW)), "B", [parcel(2)], NOW));

  it("이름을 바꾼다 (자기 자신과 같은 이름은 허용)", () => {
    const r = renameGroup(base, base[0].id, "새 이름");
    expect(r.ok && r.groups[0].name).toBe("새 이름");
    expect(renameGroup(base, base[0].id, "A").ok).toBe(true);
  });

  it("다른 묶음과 같은 이름이나 빈 이름은 거절한다", () => {
    expect(renameGroup(base, base[0].id, "B").ok).toBe(false);
    expect(renameGroup(base, base[0].id, " ").ok).toBe(false);
  });

  it("삭제하면 그 묶음만 빠진다", () => {
    expect(deleteGroup(base, base[0].id).map((g) => g.name)).toEqual(["B"]);
  });

  it("checkGroupName은 정리한 이름을 돌려준다", () => {
    expect(checkGroupName(" a  b ", []).name).toBe("a b");
  });
});

describe("묶음 불러오기", () => {
  const group = ok(addGroup([], "G", [parcel(1), parcel(2), parcel(3)], NOW))[0];

  it("목록에 같은 주소가 있으면 그 필지를 고르고, 새 필지를 더하지 않는다", () => {
    const current = [parcel(1), parcel(2), parcel(3), parcel(4)];
    const r = applyGroup(current, group);
    expect(r.selectedIds).toEqual(["p-1", "p-2", "p-3"]);
    expect(r.added).toBe(0);
    expect(r.parcels).toHaveLength(4);
  });

  it("목록에 없는 주소는 저장된 좌표로 새 필지를 더해 고른다 (목록을 올리지 않은 상태 포함)", () => {
    const r = applyGroup([], group);
    expect(r.added).toBe(3);
    expect(r.parcels).toHaveLength(3);
    expect(r.parcels[0]).toMatchObject({ address: "서울 종로구 1번지", coord: { lat: 37.501, lng: 127 }, coordSource: "saved", rowNumbers: [] });
    expect(new Set(r.parcels.map((p) => p.id)).size).toBe(3);
    expect(r.selectedIds).toEqual(r.parcels.map((p) => p.id));
  });

  it("공백이 달라도 같은 주소로 본다", () => {
    const spaced: Parcel = { ...parcel(1), address: "서울  종로구  1번지" };
    const r = applyGroup([spaced], group);
    expect(r.parcels.filter((p) => p.address.includes("1번지"))).toHaveLength(1);
  });

  it("목록에서 위치를 못 찾은 같은 주소는 저장된 좌표로 채우고, 있는 위치는 바꾸지 않는다", () => {
    const missing = parcel(1, false);
    const located = { ...parcel(2), coord: { lat: 35, lng: 129 } };
    const r = applyGroup([missing, located], group);
    expect(r.parcels[0]).toMatchObject({ coord: { lat: 37.501, lng: 127 }, needsCheck: false });
    expect(r.parcels[1].coord).toEqual({ lat: 35, lng: 129 });
  });

  it("기존 필지의 id와 겹치지 않는다", () => {
    const first = applyGroup([], group);
    const second = applyGroup(first.parcels, group);
    expect(second.added).toBe(0);
    expect(new Set(second.parcels.map((p) => p.id)).size).toBe(second.parcels.length);
  });

  it("대한민국 밖 좌표는 건너뛴다", () => {
    const bad: ParcelGroup = { ...group, parcels: [{ address: "X", lat: 10, lng: 10 }, group.parcels[0]] };
    expect(applyGroup([], bad).selectedIds).toHaveLength(1);
  });
});

describe("저장소에서 읽기", () => {
  it("없거나 깨진 값은 빈 목록이다", () => {
    expect(parseStoredGroups(null)).toEqual([]);
    expect(parseStoredGroups("{깨짐")).toEqual([]);
    expect(parseStoredGroups('{"a":1}')).toEqual([]);
  });

  it("형식이 맞는 묶음만 남기고 주소·좌표 외의 값은 읽지 않는다", () => {
    const text = JSON.stringify([
      { id: "g1", name: "A", savedAt: "x", parcels: [{ address: "a", lat: 37, lng: 127, memo: "개인정보" }] },
      { id: "g2", name: 3, savedAt: "x", parcels: [] },
      { id: "g3", name: "빈 묶음", savedAt: "x", parcels: [{ address: 1 }] },
    ]);
    const r = parseStoredGroups(text);
    expect(r).toHaveLength(1);
    expect(r[0].parcels).toEqual([{ address: "a", lat: 37, lng: 127 }]);
  });

  it("묶음 20개·묶음당 30필지를 넘는 값은 잘라 낸다", () => {
    const parcels = Array.from({ length: 40 }, (_, i) => ({ address: `a${i}`, lat: 37, lng: 127 }));
    const text = JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: `g${i}`, name: `n${i}`, savedAt: "x", parcels })));
    const r = parseStoredGroups(text);
    expect(r).toHaveLength(20);
    expect(r[0].parcels).toHaveLength(30);
  });
});
