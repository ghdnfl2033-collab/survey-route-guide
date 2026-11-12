import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readParcelFile } from "@/lib/client/excel";

function xlsxFile(aoa: unknown[][], name = "목록.xlsx"): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], name);
}

describe("readParcelFile — 파일 읽기", () => {
  it(".xlsx: 첫 열만 읽고 두 번째 열 이후는 무시한다", async () => {
    const r = await readParcelFile(
      xlsxFile([
        ["서울 종로구 1-1", "홍길동", "010-0000-0000"],
        ["서울 중구 2-2", "김철수", "010-1111-1111"],
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.addresses.map((a) => a.address)).toEqual(["서울 종로구 1-1", "서울 중구 2-2"]);
      // 개인정보가 결과 어디에도 담기지 않는다
      expect(JSON.stringify(r)).not.toContain("홍길동");
      expect(JSON.stringify(r)).not.toContain("010");
    }
  });

  it(".xlsx: 맨 윗줄이 비어 있어도 줄 번호가 어긋나지 않는다", async () => {
    const r = await readParcelFile(xlsxFile([[null], ["서울 종로구 1-1"], [123]]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.addresses).toEqual([{ row: 2, address: "서울 종로구 1-1" }]);
      expect(r.unreadableRows).toEqual([3]);
    }
  });

  it(".xlsx: 첫 번째 시트만 읽는다", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["첫 시트 주소"]]), "A");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["둘째 시트 주소"]]), "B");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const r = await readParcelFile(new File([bytes], "두시트.xlsx"));
    expect(r.ok && r.addresses.map((a) => a.address)).toEqual(["첫 시트 주소"]);
  });

  it(".csv(UTF-8): 지번이 날짜·숫자로 바뀌지 않는다", async () => {
    const csv = "서울 종로구 청운동 1-2,메모\n경기 수원시 3-4\n";
    const r = await readParcelFile(new File([csv], "목록.csv"));
    expect(r.ok && r.addresses.map((a) => a.address)).toEqual(["서울 종로구 청운동 1-2", "경기 수원시 3-4"]);
  });

  it(".csv(UTF-8 BOM)을 읽는다", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("서울 1-1\n")]);
    const r = await readParcelFile(new File([bytes], "bom.csv"));
    expect(r.ok && r.addresses[0].address.replace("﻿", "")).toBe("서울 1-1");
  });

  it(".csv(CP949): 한국어 엑셀이 저장한 파일도 글자가 깨지지 않는다", async () => {
    // "서울" = CP949 바이트 BC AD BF EF
    const bytes = new Uint8Array([0xbc, 0xad, 0xbf, 0xef, 0x20, 0x31, 0x2d, 0x31, 0x0a]);
    expect(new TextDecoder("euc-kr").decode(bytes)).toContain("서울");
    const r = await readParcelFile(new File([bytes], "cp949.csv"));
    expect(r.ok && r.addresses[0].address).toBe("서울 1-1");
  });

  it(".xlsx/.csv가 아니면 거부한다", async () => {
    const r = await readParcelFile(new File(["x"], "목록.txt"));
    expect(r).toEqual({ ok: false, message: "엑셀(.xlsx) 또는 CSV 파일만 올릴 수 있어요." });
  });

  it("읽을 줄이 하나도 없으면 안내한다", async () => {
    const r = await readParcelFile(new File([""], "빈파일.csv"));
    expect(r.ok).toBe(false);
  });
});
