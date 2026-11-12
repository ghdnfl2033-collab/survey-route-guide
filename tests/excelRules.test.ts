import { describe, expect, it } from "vitest";
import { MAX_ADDRESS_LENGTH, readAddressColumn } from "@/lib/core/excelRules";

describe("readAddressColumn — 첫 열을 주소로 읽는 규칙", () => {
  it("제목 행 없이 첫 줄부터 주소로 읽는다", () => {
    const r = readAddressColumn(["서울 종로구 청운동 1-1", "서울 중구 태평로1가 31"]);
    expect(r.addresses).toEqual([
      { row: 1, address: "서울 종로구 청운동 1-1" },
      { row: 2, address: "서울 중구 태평로1가 31" },
    ]);
  });

  it("앞뒤 공백은 지운다", () => {
    expect(readAddressColumn(["  서울 종로구 1-1  "]).addresses[0].address).toBe("서울 종로구 1-1");
  });

  it("빈 줄은 건너뛰되 줄 번호는 원래 번호를 유지한다", () => {
    const r = readAddressColumn(["주소A", null, "   ", "주소B"]);
    expect(r.addresses.map((a) => a.row)).toEqual([1, 4]);
    expect(r.blankCount).toBe(2);
  });

  it("파일 끝의 빈 줄은 건너뛴 빈 줄로 세지 않는다", () => {
    const r = readAddressColumn(["주소A", null, "", null]);
    expect(r.addresses).toHaveLength(1);
    expect(r.blankCount).toBe(0);
  });

  it("숫자·날짜·참거짓 칸은 읽지 못한 줄로 알려 준다", () => {
    const r = readAddressColumn(["주소A", 123, new Date(), true, "주소B"]);
    expect(r.unreadableRows).toEqual([2, 3, 4]);
    expect(r.addresses.map((a) => a.row)).toEqual([1, 5]);
  });

  it(`${MAX_ADDRESS_LENGTH}자를 넘는 칸은 읽지 못한 줄이다`, () => {
    const r = readAddressColumn(["가".repeat(MAX_ADDRESS_LENGTH + 1), "가".repeat(MAX_ADDRESS_LENGTH)]);
    expect(r.unreadableRows).toEqual([1]);
    expect(r.addresses).toHaveLength(1);
  });

  it("같은 주소가 여러 번 나와도 여기서는 합치지 않는다 (합치기는 작업 9)", () => {
    expect(readAddressColumn(["주소A", "주소A"]).addresses).toHaveLength(2);
  });
});
