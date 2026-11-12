import { describe, expect, it } from "vitest";
import { MAX_PASTE_LINES, parsePastedText } from "@/lib/core/pasteText";

const ok = (r: ReturnType<typeof parsePastedText>) => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("붙여넣은 주소 읽기", () => {
  it("한 줄에 주소 하나씩 읽고 원본 줄 번호는 시작 값 뒤로 붙인다", () => {
    const r = ok(parsePastedText("서울 종로구 1\n서울 종로구 2", [], 10));
    expect(r.parcels).toEqual([
      { address: "서울 종로구 1", rowNumbers: [11] },
      { address: "서울 종로구 2", rowNumbers: [12] },
    ]);
  });

  it("윈도 줄바꿈·빈 줄·앞뒤 공백을 처리하고 끝의 빈 줄은 세지 않는다", () => {
    const r = ok(parsePastedText("  서울 A  \r\n\r\n서울 B\r\n\r\n", [], 0));
    expect(r.parcels.map((p) => p.address)).toEqual(["서울 A", "서울 B"]);
    expect(r.blankCount).toBe(1);
  });

  it("엑셀에서 여러 열을 복사해도 첫 번째 열만 읽는다", () => {
    const r = ok(parsePastedText("서울 A\t홍길동\t010-1234-5678\n서울 B\t김철수", [], 0));
    expect(r.parcels.map((p) => p.address)).toEqual(["서울 A", "서울 B"]);
    expect(JSON.stringify(r)).not.toContain("홍길동");
  });

  it("붙여넣은 안의 같은 주소는 합치고, 이미 목록에 있는 주소는 건너뛴다", () => {
    const r = ok(parsePastedText("서울 A\n서울  A\n서울 B\n서울 C", ["서울 C"], 0));
    expect(r.mergedCount).toBe(1);
    expect(r.alreadyCount).toBe(1);
    expect(r.parcels.map((p) => p.address)).toEqual(["서울 A", "서울 B"]);
  });

  it("너무 긴 줄은 읽지 못한 줄 번호로 알려 준다", () => {
    const r = ok(parsePastedText(`서울 A\n${"가".repeat(300)}\n서울 B`, [], 0));
    expect(r.unreadableLines).toEqual([2]);
    expect(r.parcels).toHaveLength(2);
  });

  it("주소가 하나도 없거나 1000줄을 넘으면 안내한다", () => {
    expect(parsePastedText("  \n\n", [], 0).ok).toBe(false);
    const many = Array.from({ length: MAX_PASTE_LINES + 5 }, (_, i) => `서울 ${i}`).join("\n");
    expect(parsePastedText(many, [], 0).ok).toBe(false);
    const exact = Array.from({ length: MAX_PASTE_LINES }, (_, i) => `서울 ${i}`).join("\n");
    expect(parsePastedText(exact, [], 0).ok).toBe(true);
  });
});
