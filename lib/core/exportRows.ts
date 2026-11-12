// Design Ref: §4.2 ⑨ — 결과를 엑셀로 내려받을 때 담을 내용 (순수 계산, 파일 만들기는 lib/client/exportExcel.ts)
// Plan SC: PRD 5장 must 2 — 표에는 필지마다 방문 순번, 다음 필지까지 예상 거리(km)와 시간(분), 대중교통은 환승 횟수,
//          "추정값"·"도보 구간"·"도로 끝에서 도보 이동 필요" 표시 / PRD 4장 — 결과를 엑셀로 내려받아 현장에 가져간다

import { legRideTexts } from "./transitText";
import { formatClock, formatDuration, type RoutePlan } from "./route";
import { END_MODE_LABELS, MODE_LABELS } from "./settings";
import { getRecord, type SurveyRecords } from "./survey";
import type { Leg, Parcel, RouteSettings } from "./types";

/** 조사 기록 열 머리글 */
export const RECORD_HEADERS = ["조사 완료", "이용 현황", "메모"];

export type ExportCell = string | number;

export type ExportContent = {
  /** 엑셀 맨 위 요약 (항목, 값) */
  summary: [string, ExportCell][];
  /** 표 머리글 */
  header: string[];
  /** 표 본문: 0번 줄은 출발지, 1번부터 필지 (복귀 설정이면 마지막에 출발지 복귀 줄) */
  rows: ExportCell[][];
  /** 표 아래에 붙이는 안내 문구 */
  notes: string[];
};

/** 한 구간에 붙는 표시 글자: 추정값, 도보 구간, 도로 끝에서 도보 이동 필요(필지에 도착하는 구간) */
export function legMarks(leg: Leg | undefined, arrival: Leg | undefined): string {
  const marks: string[] = [];
  if (arrival?.roadEndWalk) {
    marks.push(arrival.roadEndMeters !== undefined ? `도로 끝에서 도보 이동 필요 (약 ${arrival.roadEndMeters}m)` : "도로 끝에서 도보 이동 필요");
  }
  if (leg?.walkFallback) marks.push("도보 구간");
  if (leg?.estimated) marks.push("추정값");
  return marks.join(", ");
}

/** 엑셀에 넣을 파일 이름: 조사 날짜와 이동 수단이 들어간다 (파일 이름에 쓸 수 없는 글자는 쓰지 않음) */
export function exportFileName(settings: RouteSettings): string {
  return `실태조사_동선_${settings.date}_${MODE_LABELS[settings.mode]}.xlsx`;
}

/** 결과(동선 계획)를 엑셀에 담을 내용으로 바꾼다. */
export function buildExportContent(
  settings: RouteSettings,
  plan: RoutePlan,
  parcels: readonly Parcel[],
  /** 조사 기록(nice 1). 주면 조사 완료·이용 현황·메모 열이 붙는다 */
  records?: SurveyRecords,
  /** 조사 완료라서 이번 계산에서 뺀 필지: 표 맨 아래에 기록과 함께 적는다 */
  excluded: readonly Parcel[] = [],
): ExportContent {
  const withRecords = records !== undefined;
  const byId = new Map(parcels.map((p) => [p.id, p]));
  const parcelCount = plan.orderIds.length;
  const transit = settings.mode === "transit";

  const endMinutes =
    plan.returnMinutes !== undefined
      ? plan.returnMinutes
      : parcelCount > 0
        ? plan.arrivalMinutes[parcelCount - 1] + settings.inspectMinutes
        : plan.departMinutes;

  const summary: [string, ExportCell][] = [
    ["조사 날짜", settings.date],
    ["출발지", settings.origin.address],
    ["출발 시각", settings.departTime],
    ["동선 끝내는 곳", END_MODE_LABELS[settings.endMode]],
    ["이동 수단", MODE_LABELS[settings.mode]],
    ["필지당 조사 시간(분)", settings.inspectMinutes],
    ["방문할 필지 수", parcelCount],
    ["총 소요 시간", formatDuration(plan.totalMinutes)],
    ["이동 시간", formatDuration(plan.travelMinutes)],
    ["조사 시간", formatDuration(plan.inspectMinutes)],
    [plan.returnMinutes !== undefined ? "출발지 복귀 예정" : "조사 끝 예정", formatClock(endMinutes)],
  ];

  const header = ["순번", "지번 주소", "시각", "다음까지 거리(km)", "다음까지 시간(분)", ...(transit ? ["환승 횟수", "이용 노선"] : []), "표시", "엑셀 원본 줄 번호", ...(withRecords ? RECORD_HEADERS : [])];
  const emptyRecordCells: ExportCell[] = withRecords ? ["", "", ""] : [];
  const recordCells = (id: string): ExportCell[] => {
    if (!records) return [];
    const r = getRecord(records, id);
    return [r.done ? "완료" : "", r.usage, r.memo];
  };

  const legCells = (leg: Leg | undefined): ExportCell[] => [
    leg ? leg.distanceKm : "-",
    leg ? leg.minutes : "-",
    ...(transit ? [leg?.transfers !== undefined ? leg.transfers : "-", legRideTexts(leg).join(" → ") || "-"] : []),
  ];

  const rows: ExportCell[][] = [
    [0, `출발지 · ${settings.origin.address}`, `${formatClock(plan.departMinutes)} 출발`, ...legCells(plan.legs[0]), legMarks(plan.legs[0], undefined), "", ...emptyRecordCells],
  ];
  plan.orderIds.forEach((id, i) => {
    const parcel = byId.get(id);
    const isLast = i === parcelCount - 1;
    const next = plan.legs[i + 1];
    rows.push([
      i + 1,
      (parcel?.address ?? id) + (isLast && next ? " → 출발지로 돌아오기" : ""),
      `${formatClock(plan.arrivalMinutes[i])} 도착`,
      ...legCells(next),
      legMarks(next, plan.legs[i]),
      parcel?.rowNumbers.join(", ") ?? "",
      ...recordCells(id),
    ]);
  });
  if (plan.returnMinutes !== undefined) {
    rows.push(["-", "출발지 (복귀)", `${formatClock(plan.returnMinutes)} 도착`, ...legCells(undefined), "", "", ...emptyRecordCells]);
  }

  // 조사 완료로 뺀 필지: 순번·시각·이동 칸은 "-"로 두고 기록만 남긴다
  excluded.forEach((p) => {
    rows.push([
      "-",
      `${p.address} (조사 완료로 제외)`,
      "-",
      "-",
      "-",
      ...(transit ? ["-", "-"] : []),
      "",
      p.rowNumbers.join(", "),
      ...recordCells(p.id),
    ]);
  });

  const notes: string[] = [];
  if (excluded.length > 0) {
    notes.push(`'조사 완료'로 표시한 ${excluded.length}개 필지는 방문 순서 계산에서 뺐습니다(표 맨 아래 '조사 완료로 제외' 줄).`);
  }
  if (plan.legs.length > 0 && plan.estimatedLegCount === plan.legs.length) {
    notes.push("전체 구간이 추정값입니다. 길찾기 결과를 얻지 못해 직선거리(×1.3)와 평균 속도로 계산했습니다. 실제 시간과 거리는 다를 수 있습니다.");
  } else if (plan.estimatedLegCount > 0) {
    notes.push(`${plan.legs.length}개 구간 중 ${plan.estimatedLegCount}개는 길찾기 결과를 얻지 못해 직선거리로 추정했습니다(표시 열의 '추정값').`);
  }
  if (plan.legs.length > 0 && plan.estimatedLegCount < plan.legs.length) {
    if (settings.mode === "car") notes.push("카카오 길찾기 기준입니다. 시간은 지금의 교통 상황 기준이며, 조사 날짜·출발 시각의 교통 상황은 반영하지 않았습니다.");
    if (settings.mode === "walk") notes.push("방문 순서는 걷는 거리가 짧도록 직선거리로 정했고, 구간별 걷는 시간과 거리는 카카오 길찾기로 확인했습니다.");
    if (transit) {
      notes.push("방문 순서는 직선거리로 정했고, 구간별 시간(걷는 시간·환승 포함)과 환승 횟수는 카카오 대중교통 길찾기로 확인했습니다. 지금 운행 중인 노선 기준이며, 조사 날짜·출발 시각의 운행 시간표는 반영하지 않았습니다.");
    }
  }
  if (plan.legs.some((l) => l.roadEndWalk)) {
    notes.push("'도로 끝에서 도보 이동 필요'로 표시한 필지는 차가 들어갈 수 있는 도로 끝까지의 시간만 계산했고, 도로 끝에서 필지까지 걷는 시간은 포함하지 않았습니다.");
  }
  if (plan.manual) notes.push("방문 순서를 직접 바꿨습니다. 최단 순서가 아닐 수 있으며, 시각과 총 소요 시간은 바꾼 순서 기준으로 다시 계산했습니다.");
  else if (!plan.exact) notes.push("필지가 13곳 이상이라 최단에 가까운 순서로 계산했습니다(최단이 아닐 수 있습니다).");

  return { summary, header, rows, notes };
}
