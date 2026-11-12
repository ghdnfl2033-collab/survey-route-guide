// Design Ref: §4.2 ① — 파일은 브라우저 안에서만 읽는다 (서버로 보내지 않음)
// 개인정보: 첫 번째 시트의 첫 번째 열(A열)만 읽는다. 다른 열은 읽지도 않는다.

import { readAddressColumn, type ColumnReadResult } from "@/lib/core/excelRules";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export type ExcelReadResult =
  | ({ ok: true; fileName: string } & ColumnReadResult)
  | { ok: false; message: string };

/** CSV 글자 깨짐 방지: UTF-8로 읽어 보고 안 맞으면 한국어 엑셀 기본인 CP949(EUC-KR)로 읽는다 */
function decodeCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

export async function readParcelFile(file: File): Promise<ExcelReadResult> {
  const name = file.name.toLowerCase();
  const isXlsx = name.endsWith(".xlsx");
  const isCsv = name.endsWith(".csv");
  if (!isXlsx && !isCsv) {
    return { ok: false, message: "엑셀(.xlsx) 또는 CSV 파일만 올릴 수 있어요." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "파일이 너무 커요. 10MB 이하로 줄여서 올려 주세요." };
  }

  try {
    // 무거운 엑셀 도구는 파일을 올릴 때만 불러온다
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();

    const workbook = isCsv
      // raw: 글자를 날짜·숫자로 바꾸지 않는다 ("1-2" 같은 지번이 날짜로 변하는 것 방지)
      ? XLSX.read(decodeCsv(buffer), { type: "string", raw: true })
      : XLSX.read(buffer, { type: "array" });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const ref = sheet?.["!ref"];
    if (!sheet || !ref) {
      return { ok: false, message: "읽을 수 있는 주소가 없어요. 첫 번째 시트의 첫 번째 열에 주소를 적어 주세요." };
    }

    // A열(첫 번째 열)만, 1번째 줄부터 마지막 줄까지 읽는다. 줄 번호가 어긋나지 않도록 항상 1번째 줄에서 시작.
    const lastRow = XLSX.utils.decode_range(ref).e.r;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      blankrows: true,
      defval: null,
      range: { s: { r: 0, c: 0 }, e: { r: lastRow, c: 0 } },
    });
    const cells = rows.map((row) => row[0]);

    const result = readAddressColumn(cells);
    if (result.addresses.length === 0 && result.unreadableRows.length === 0) {
      return { ok: false, message: "읽을 수 있는 주소가 없어요. 첫 번째 시트의 첫 번째 열에 주소를 적어 주세요." };
    }
    return { ok: true, fileName: file.name, ...result };
  } catch {
    return { ok: false, message: "파일을 읽지 못했어요. 파일이 손상되었거나 암호가 걸려 있지 않은지 확인해 주세요." };
  }
}
