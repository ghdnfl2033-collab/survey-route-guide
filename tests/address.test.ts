import { describe, expect, it } from "vitest";
import { addressKey, mergeDuplicateAddresses } from "@/lib/core/address";

const rows = (...list: [number, string][]) => list.map(([row, address]) => ({ row, address }));

describe("mergeDuplicateAddresses — 같은 주소 합치기", () => {
  it("같은 주소는 하나로 합치고 줄 번호를 모두 남긴다", () => {
    const r = mergeDuplicateAddresses(rows([1, "서울 종로구 1-1"], [2, "서울 중구 2-2"], [3, "서울 종로구 1-1"]));
    expect(r.parcels).toEqual([
      { address: "서울 종로구 1-1", rowNumbers: [1, 3] },
      { address: "서울 중구 2-2", rowNumbers: [2] },
    ]);
    expect(r.mergedCount).toBe(1);
  });

  it("3번 나오면 합쳐서 없어진 줄은 2개다", () => {
    const r = mergeDuplicateAddresses(rows([1, "A"], [2, "A"], [3, "A"]));
    expect(r.parcels).toHaveLength(1);
    expect(r.mergedCount).toBe(2);
  });

  it("연속 공백·전각 공백 차이는 같은 주소로 본다", () => {
    const r = mergeDuplicateAddresses(rows([1, "서울  종로구 1-1"], [2, "서울　종로구 1-1 "]));
    expect(r.parcels).toHaveLength(1);
    expect(r.parcels[0].address).toBe("서울 종로구 1-1");
  });

  it("괄호나 '산' 표기가 다르면 다른 주소로 둔다", () => {
    const r = mergeDuplicateAddresses(rows([1, "서울 종로구 1-1"], [2, "서울 종로구 산 1-1"], [3, "서울 종로구 1-1 (본관)"]));
    expect(r.parcels).toHaveLength(3);
    expect(r.mergedCount).toBe(0);
  });

  it("처음 나온 순서를 유지한다", () => {
    const r = mergeDuplicateAddresses(rows([1, "B"], [2, "A"], [3, "B"]));
    expect(r.parcels.map((p) => p.address)).toEqual(["B", "A"]);
  });

  it("빈 목록은 빈 결과다", () => {
    expect(mergeDuplicateAddresses([])).toEqual({ parcels: [], mergedCount: 0 });
  });

  it("addressKey는 앞뒤 공백을 지운다", () => {
    expect(addressKey("  가  나 ")).toBe("가 나");
  });
});
