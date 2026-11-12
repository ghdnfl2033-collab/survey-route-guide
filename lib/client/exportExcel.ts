// Design Ref: §4.2 ⑨ — 결과 엑셀 파일은 브라우저에서만 만들어 내려받는다 (서버로 보내지 않음, 서버에 저장하지 않음)
// 공공기관 표 양식: 첫 줄부터 테두리 있는 동선표, 아래에 유의사항, A4 가로 인쇄 설정

import { buildExportContent, exportFileName, type ExportContent } from "@/lib/core/exportRows";
import type { RoutePlan } from "@/lib/core/route";
import type { SurveyRecords } from "@/lib/core/survey";
import type { Parcel, RouteSettings } from "@/lib/core/types";

const SHEET_NAME = "동선";

// 표 머리글 이름별 열 너비(글자 수)
const COLUMN_WIDTHS: Record<string, number> = {
  순번: 8,
  "지번 주소": 46,
  시각: 14,
  "다음까지 거리(km)": 16,
  "다음까지 시간(분)": 16,
  "환승 횟수": 11,
  "이용 노선": 48,
  표시: 30,
  "엑셀 원본 줄 번호": 14,
  "조사 완료": 11,
  "이용 현황": 18,
  메모: 32,
};

/** 엑셀 내용(표 + 안내)을 한 시트의 줄 목록으로 편다. 첫 줄부터 표 머리글(순번, 지번 주소…)이다. */
export function toSheetRows(content: ExportContent): (string | number)[][] {
  const rows: (string | number)[][] = [content.header, ...content.rows];
  if (content.notes.length > 0) {
    rows.push([]);
    content.notes.forEach((note) => rows.push([`※ ${note}`]));
  }
  return rows;
}


/** 결과를 .xlsx 파일의 바이트로 만든다. (내려받기와 점검에서 같이 쓴다) */
export async function buildRouteWorkbook(settings: RouteSettings, plan: RoutePlan, parcels: readonly Parcel[], records?: SurveyRecords, excluded: readonly Parcel[] = []): Promise<ArrayBuffer> {
  // 무거운 엑셀 도구는 내려받을 때만 불러온다
  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;

  const content = buildExportContent(settings, plan, parcels, records, excluded);
  const rows = toSheetRows(content);
  const colCount = content.header.length;

  const FONT = "맑은 고딕";
  const NAVY = "FF1F3864";
  const GRAY_FILL = "FFF2F2F2";
  const thin = { style: "thin" as const, color: { argb: "FF595959" } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  const book = new ExcelJS.Workbook();
  book.creator = "실태조사 길잡이";
    const sheet = book.addWorksheet(SHEET_NAME, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: "&C&P / &N 쪽" },
  });

  content.header.forEach((name, i) => {
    sheet.getColumn(i + 1).width = COLUMN_WIDTHS[name] ?? 14;
  });

  // 줄 내용 채우기 (값만 먼저, 서식은 아래에서 영역별로)
  rows.forEach((r, i) => {
    r.forEach((v, c) => {
      if (v !== "" && v !== undefined) sheet.getCell(i + 1, c + 1).value = v;
    });
  });

  const lastCol = colCount;
  const font = (over: object = {}) => ({ name: FONT, size: 10, ...over });

  // ── 동선표: 머리글(남색) + 테두리 + 정렬 ──
  const headerRow = 1;
  const names = content.header;
  const centerCols = new Set(["순번", "시각", "환승 횟수", "엑셀 원본 줄 번호", "조사 완료"]);
  const numberCols = new Set(["다음까지 거리(km)", "다음까지 시간(분)"]);
  for (let c = 1; c <= lastCol; c++) {
    const cell = sheet.getCell(headerRow, c);
    cell.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = box;
  }
  sheet.getRow(headerRow).height = 30;
  sheet.views = [{ showGridLines: false, state: "frozen", ySplit: headerRow }];
  sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

  content.rows.forEach((row, i) => {
    const r = headerRow + 1 + i;
    const isOrigin = i === 0 || row[0] === "-";
    const isExcluded = typeof row[1] === "string" && row[1].endsWith("(조사 완료로 제외)");
    for (let c = 1; c <= lastCol; c++) {
      const cell = sheet.getCell(r, c);
      const name = names[c - 1];
      cell.border = box;
      cell.font = font(isExcluded ? { color: { argb: "FF7F7F7F" }, italic: true } : {});
      if (isOrigin && !isExcluded) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_FILL } };
      const horizontal = centerCols.has(name) ? "center" : numberCols.has(name) ? "right" : "left";
      cell.alignment = { horizontal, vertical: "middle", wrapText: true, ...(horizontal === "left" ? { indent: 1 } : {}) };
      if (numberCols.has(name) && typeof row[c - 1] === "number") cell.numFmt = name === "다음까지 거리(km)" ? "0.0" : "0";
    }
    sheet.getRow(r).height = 22;
  });

  // ── 유의사항 ──
  const r = headerRow + content.rows.length + 2;
  if (content.notes.length > 0) {
    content.notes.forEach((_, i) => {
      sheet.mergeCells(r + i, 1, r + i, lastCol);
      const cell = sheet.getCell(r + i, 1);
      cell.font = font({ size: 9, color: { argb: "FF404040" } });
      cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      sheet.getRow(r + i).height = 26;
    });
  }

  const out = await book.xlsx.writeBuffer();
  const u8 = out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayLike<number>);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** 결과를 엑셀 파일로 만들어 내려받는다. */
export async function downloadRouteExcel(settings: RouteSettings, plan: RoutePlan, parcels: readonly Parcel[], records?: SurveyRecords, excluded: readonly Parcel[] = []): Promise<string> {
  const bytes = await buildRouteWorkbook(settings, plan, parcels, records, excluded);
  const fileName = exportFileName(settings);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 내려받기가 시작된 뒤에 주소를 정리한다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
