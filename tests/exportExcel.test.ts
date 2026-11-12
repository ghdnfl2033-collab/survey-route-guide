import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildRouteWorkbook, toSheetRows } from "@/lib/client/exportExcel";
import { buildExportContent } from "@/lib/core/exportRows";
import { planRoute, repricePlan } from "@/lib/core/route";
import type { Parcel, RouteSettings } from "@/lib/core/types";

const ORIGIN = { lat: 37.5665, lng: 126.978 };
const parcel = (n: number, dLat: number, address = `서울 종로구 ${n}번지`): Parcel => ({
  id: `p-${n}`,
  address,
  rowNumbers: [n],
  coord: { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng },
  needsCheck: false,
});
const settings = (over: Partial<RouteSettings> = {}): RouteSettings => ({
  origin: { address: "서울 중구 세종대로 110", coord: ORIGIN },
  date: "2027-03-15",
  departTime: "09:00",
  endMode: "return",
  mode: "car",
  inspectMinutes: 10,
  ...over,
});
const parcels = [parcel(1, 0.01), parcel(2, 0.02), parcel(3, 0.03)];

/** 만든 파일을 다시 읽어 줄 목록으로 되돌린다 */
async function readBack(s: RouteSettings, plan = planRoute(s, parcels), list = parcels) {
  const bytes = await buildRouteWorkbook(s, plan, list);
  const book = XLSX.read(bytes, { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  return { book, sheet, rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: null }) };
}

describe("buildRouteWorkbook — 결과 엑셀 파일", () => {
  it("올바른 .xlsx 파일이고 시트 이름은 '동선'이다 (다시 읽을 수 있다)", async () => {
    const { book } = await readBack(settings());
    expect(book.SheetNames).toEqual(["동선"]);
  });

  it("맨 첫 줄부터 표 머리글(순번, 지번 주소…)로 시작한다 (제목·결재란 없음)", async () => {
    const { rows } = await readBack(settings());
    expect(rows[0][0]).toBe("순번");
    expect(rows[0][1]).toBe("지번 주소");
  });

  it("표의 머리글과 줄이 모두 들어 있고, 순번 0(출발지)부터 시작한다", async () => {
    const s = settings();
    const content = buildExportContent(s, planRoute(s, parcels), parcels);
    const { rows } = await readBack(s);
    const headerAt = rows.findIndex((r) => r[0] === "순번");
    expect(headerAt).toBe(0);
    expect(rows[headerAt]).toEqual(content.header);
    const table = rows.slice(headerAt + 1, headerAt + 1 + content.rows.length);
    expect(table).toHaveLength(content.rows.length);
    expect(table[0][0]).toBe(0);
    expect(String(table[0][1])).toContain("출발지");
    // 방문 순서대로 주소가 들어 있다
    const plan = planRoute(s, parcels);
    plan.orderIds.forEach((id, i) => expect(String(table[i + 1][1])).toContain(parcels.find((p) => p.id === id)!.address));
  });

  it("거리와 시간은 숫자 칸이다 (엑셀에서 합계를 낼 수 있다)", async () => {
    const s = settings({ endMode: "lastParcel" });
    const { sheet, rows } = await readBack(s);
    const headerAt = rows.findIndex((r) => r[0] === "순번");
    const firstRow = headerAt + 2; // 엑셀 줄 번호는 1부터, 표 첫 줄(0번 출발지)
    expect(sheet[`D${firstRow}`].t).toBe("n");
    expect(sheet[`E${firstRow}`].t).toBe("n");
  });

  it("표 아래에 안내 문구가 붙는다 (추정값 계산이면 그 사실을 적는다)", async () => {
    const { rows } = await readBack(settings());
    const text = rows.map((r) => String(r[0] ?? "")).join("\n");
    expect(text).toContain("※ 전체 구간이 추정값입니다");
  });

  it("대중교통은 환승 횟수 열이 들어가고, 표시 열에 도보 구간이 적힌다", async () => {
    const t = settings({ mode: "transit", endMode: "lastParcel" });
    const base = planRoute(t, parcels);
    const plan = repricePlan(t, base, [
      { ok: true, minutes: 12, km: 2, transfers: 2, walkFallback: false },
      { ok: true, minutes: 5, km: 0.4, transfers: 0, walkFallback: true },
      { ok: true, minutes: 20, km: 6, transfers: 1 },
    ]);
    const { rows } = await readBack(t, plan);
    const headerAt = rows.findIndex((r) => r[0] === "순번");
    expect(rows[headerAt]).toContain("환승 횟수");
    const col = (rows[headerAt] as string[]).indexOf("환승 횟수");
    expect(rows[headerAt + 1][col]).toBe(2);
    expect(rows.slice(headerAt + 1).some((r) => r.includes("도보 구간"))).toBe(true);
  });

  it("주소가 '='로 시작해도 식이 아니라 글자로 저장된다 (엑셀 식 삽입 방지)", async () => {
    const evil = [parcel(1, 0.01, "=1+1"), parcel(2, 0.02, "+SUM(A1:A2)"), parcel(3, 0.03, "@cmd")];
    const s = settings({ endMode: "lastParcel" });
    const { sheet } = await readBack(s, planRoute(s, evil), evil);
    const cells = Object.entries(sheet).filter(([k, v]) => !k.startsWith("!") && typeof (v as { v?: unknown }).v === "string");
    const dangerous = cells.filter(([, v]) => /^[=+@]/.test(String((v as { v: string }).v)));
    expect(dangerous.length).toBeGreaterThan(0); // 위험해 보이는 글자가 실제로 들어 있고
    dangerous.forEach(([, v]) => {
      expect((v as { t: string }).t).toBe("s"); // 글자 칸이며
      expect((v as { f?: string }).f).toBeUndefined(); // 식(formula)이 아니다
    });
  });

  it("개인정보: 파일 안에는 주소와 계산 결과만 있고 좌표나 내부 id는 없다", async () => {
    const s = settings();
    const bytes = await buildRouteWorkbook(s, planRoute(s, parcels), parcels);
    const book = XLSX.read(bytes, { type: "array" });
    const all = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets["동선"], { header: 1 }));
    expect(all).not.toContain("p-1");
    expect(all).not.toContain(String(ORIGIN.lat));
    expect(all).not.toContain("coord");
  });

  it("30필지도 문제없이 만든다", async () => {
    const many = Array.from({ length: 30 }, (_, i) => parcel(i + 1, ((i * 7) % 30) * 0.004));
    const s = settings();
    const t = performance.now();
    const { rows } = await readBack(s, planRoute(s, many), many);
    expect(rows.filter((r) => typeof r[0] === "number").length).toBeGreaterThanOrEqual(31); // 0번 + 필지 30개
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("toSheetRows", () => {
  it("표, 안내 순서로 줄을 편다", () => {
    const content = { summary: [["가", 1]] as [string, number][], header: ["a", "b"], rows: [[1, 2]], notes: ["안내"] };
    expect(toSheetRows(content)).toEqual([["a", "b"], [1, 2], [], ["※ 안내"]]);
  });

  it("안내가 없으면 안내 줄을 붙이지 않는다", () => {
    expect(toSheetRows({ summary: [], header: ["a"], rows: [], notes: [] })).toEqual([["a"]]);
  });
});

describe("조사 기록이 든 엑셀 파일", () => {
  it("파일을 다시 읽으면 조사 완료·이용 현황·메모가 해당 필지 줄에 들어 있다", async () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = planRoute(s, parcels);
    const target = plan.orderIds[0];
    const bytes = await buildRouteWorkbook(s, plan, parcels, {
      [target]: { parcelId: target, done: true, usage: "임대 중", memo: "=1+1 담장" },
    });
    const book = XLSX.read(bytes, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, blankrows: false, defval: "" });
    const headerIdx = rows.findIndex((r) => r[0] === "순번");
    expect(rows[headerIdx].slice(-3)).toEqual(["조사 완료", "이용 현황", "메모"]);
    expect(rows[headerIdx + 2].slice(-3)).toEqual(["완료", "임대 중", "=1+1 담장"]);
    // 수식처럼 보이는 글자도 계산되지 않고 글자 그대로 저장된다
    const memoCell = Object.values(book.Sheets[book.SheetNames[0]]).find((c) => (c as { v?: unknown }).v === "=1+1 담장") as XLSX.CellObject;
    expect(memoCell.t).toBe("s");
    expect(memoCell.f).toBeUndefined();
  });
});

describe("공문서 양식 (서식)", () => {
  it("제목·결재란 없이 A4 가로 한 쪽 너비로 인쇄된다", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const s = settings();
    const bytes = await buildRouteWorkbook(s, planRoute(s, parcels), parcels);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.getWorksheet("동선")!;
    expect(sheet.getCell(1, 1).value).toBe("순번");
    expect(sheet.pageSetup.orientation).toBe("landscape");
    expect(sheet.pageSetup.fitToWidth).toBe(1);
  });

  it("표 머리글은 남색 바탕에 테두리가 있고, 본문 칸에도 테두리가 있다", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const s = settings();
    const bytes = await buildRouteWorkbook(s, planRoute(s, parcels), parcels);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.getWorksheet("동선")!;
    let headerRow = 0;
    sheet.eachRow((row, n) => {
      if (row.getCell(1).value === "순번") headerRow = n;
    });
    expect(headerRow).toBeGreaterThan(0);
    const head = sheet.getCell(headerRow, 1);
    expect(head.fill).toMatchObject({ fgColor: { argb: "FF1F3864" } });
    expect(head.border.top?.style).toBe("thin");
    expect(sheet.getCell(headerRow + 1, 2).border.bottom?.style).toBe("thin");
  });
});
