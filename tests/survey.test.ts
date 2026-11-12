import { describe, expect, it } from "vitest";
import { countRecords, doneIds, getRecord, MAX_MEMO_LENGTH, MAX_USAGE_LENGTH, updateRecord } from "@/lib/core/survey";

describe("조사 기록", () => {
  it("기록이 없는 필지는 빈 기록으로 읽는다", () => {
    expect(getRecord({}, "a")).toEqual({ parcelId: "a", done: false, usage: "", memo: "" });
  });

  it("값을 바꾸면 새 객체를 돌려주고 원본은 그대로다", () => {
    const before = {};
    const after = updateRecord(before, "a", { done: true });
    expect(before).toEqual({});
    expect(after.a).toEqual({ parcelId: "a", done: true, usage: "", memo: "" });
  });

  it("다른 필지의 기록과 같은 필지의 다른 칸은 유지한다", () => {
    let r = updateRecord({}, "a", { memo: "담장 있음" });
    r = updateRecord(r, "b", { usage: "임대 중" });
    r = updateRecord(r, "a", { done: true });
    expect(r.a).toEqual({ parcelId: "a", done: true, usage: "", memo: "담장 있음" });
    expect(r.b.usage).toBe("임대 중");
    expect(countRecords(r)).toBe(2);
  });

  it("모든 칸이 비면 기록을 지운다", () => {
    let r = updateRecord({}, "a", { memo: "x" });
    r = updateRecord(r, "a", { memo: "" });
    expect(r).toEqual({});
  });

  it("너무 긴 입력은 잘라 낸다", () => {
    const r = updateRecord({}, "a", { memo: "가".repeat(MAX_MEMO_LENGTH + 50), usage: "나".repeat(MAX_USAGE_LENGTH + 5) });
    expect(r.a.memo).toHaveLength(MAX_MEMO_LENGTH);
    expect(r.a.usage).toHaveLength(MAX_USAGE_LENGTH);
  });

  it("조사 완료 필지 id만 골라 낸다", () => {
    let r = updateRecord({}, "a", { done: true });
    r = updateRecord(r, "b", { memo: "메모만" });
    r = updateRecord(r, "c", { done: true });
    expect(doneIds(r).sort()).toEqual(["a", "c"]);
  });
});

import { hasUnsavedRecords, snapshotRecords } from "@/lib/core/survey";

describe("저장하지 않은 기록 확인", () => {
  const empty = snapshotRecords({});

  it("기록이 없으면 경고하지 않는다", () => {
    expect(hasUnsavedRecords({}, empty)).toBe(false);
  });

  it("기록을 입력했는데 내려받지 않았으면 경고한다", () => {
    expect(hasUnsavedRecords(updateRecord({}, "a", { memo: "x" }), empty)).toBe(true);
  });

  it("내려받은 뒤에는 경고하지 않고, 그 뒤에 또 바꾸면 다시 경고한다", () => {
    const saved = updateRecord({}, "a", { memo: "x" });
    const snap = snapshotRecords(saved);
    expect(hasUnsavedRecords(saved, snap)).toBe(false);
    expect(hasUnsavedRecords(updateRecord(saved, "a", { done: true }), snap)).toBe(true);
  });

  it("입력 순서가 달라도 같은 기록이면 같은 것으로 본다", () => {
    const a = updateRecord(updateRecord({}, "a", { memo: "1" }), "b", { memo: "2" });
    const b = updateRecord(updateRecord({}, "b", { memo: "2" }), "a", { memo: "1" });
    expect(snapshotRecords(a)).toBe(snapshotRecords(b));
  });
});

import { splitDone } from "@/lib/core/survey";

describe("splitDone — 조사 완료 필지 제외", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("완료한 필지는 빼고 남은 필지만 원래 순서대로 돌려준다", () => {
    const r = updateRecord({}, "b", { done: true });
    expect(splitDone(list, r)).toEqual({ active: [{ id: "a" }, { id: "c" }], excluded: [{ id: "b" }] });
  });

  it("메모만 있고 완료 표시가 없으면 제외하지 않는다", () => {
    expect(splitDone(list, updateRecord({}, "a", { memo: "x" })).excluded).toEqual([]);
  });

  it("전부 완료면 남는 필지가 없다", () => {
    const r = ["a", "b", "c"].reduce((acc, id) => updateRecord(acc, id, { done: true }), {});
    expect(splitDone(list, r).active).toEqual([]);
  });

  it("기록은 바뀌지 않는다", () => {
    const r = updateRecord({}, "b", { done: true, memo: "m" });
    const copy = JSON.stringify(r);
    splitDone(list, r);
    expect(JSON.stringify(r)).toBe(copy);
  });
});
