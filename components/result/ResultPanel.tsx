import { useState } from "react";
import { kakaoDirectionsUrl } from "@/lib/core/kakaoLink";
import { legRideTexts } from "@/lib/core/transitText";
import WeatherNotice, { type WeatherState } from "@/components/result/WeatherNotice";
import ExportButton from "@/components/result/ExportButton";
import { addDaysToDate, formatClock, formatDuration, PARCELS_PER_DAY, type RoutePlan } from "@/lib/core/route";
import { END_MODE_LABELS, MODE_LABELS } from "@/lib/core/settings";
import {
  getRecord,
  MAX_MEMO_LENGTH,
  MAX_USAGE_LENGTH,
  MEMO_PRIVACY_NOTICE,
  USAGE_SUGGESTIONS,
  type SurveyRecord,
  type SurveyRecords,
} from "@/lib/core/survey";
import type { Parcel, RouteSettings } from "@/lib/core/types";

// 조사 기록 입력 칸 3개 (조사 완료 체크, 이용 현황, 메모)
function RecordCells({
  address,
  record,
  onChange,
}: {
  address: string;
  record: SurveyRecord;
  onChange: (change: Partial<Omit<SurveyRecord, "parcelId">>) => void;
}) {
  const input = "w-full rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-600";
  return (
    <>
      <td className="py-1 pr-2">
        <input
          type="checkbox"
          checked={record.done}
          onChange={(e) => onChange({ done: e.target.checked })}
          aria-label={`${address} 조사 완료`}
        />
      </td>
      <td className="py-1 pr-2">
        <input
          type="text"
          list="usage-suggestions"
          value={record.usage}
          maxLength={MAX_USAGE_LENGTH}
          onChange={(e) => onChange({ usage: e.target.value })}
          aria-label={`${address} 이용 현황`}
          className={input}
        />
      </td>
      <td className="py-1">
        <input
          type="text"
          value={record.memo}
          maxLength={MAX_MEMO_LENGTH}
          onChange={(e) => onChange({ memo: e.target.value })}
          aria-label={`${address} 메모`}
          className={input}
        />
      </td>
    </>
  );
}

// Design Ref: §3.3 ④ 결과 — 총 소요 시간, 방문 순서표(순번·다음 필지까지 거리·시간), 추정값 표시
export default function ResultPanel({
  settings,
  plan,
  parcels,
  excluded,
  notice,
  records,
  onRecordChange,
  onDownloaded,
  unsaved,
  onMove,
  refreshing,
  days,
  fullCount,
  onSplit,
  onMerge,
  onSelectDay,
  weather,
  stale,
}: {
  settings: RouteSettings;
  plan: RoutePlan;
  parcels: Parcel[];
  /** "조사 완료"라서 이번 계산에서 뺀 필지 */
  excluded: Parcel[];
  /** 길찾기 결과를 못 써서 직선거리로 계산했다면 그 이유 (아니면 빈 글자) */
  notice: string;
  /** 조사 기록 (필지 id → 기록) */
  records: SurveyRecords;
  onRecordChange: (parcelId: string, change: Partial<Omit<SurveyRecord, "parcelId">>) => void;
  /** 엑셀 내려받기가 끝났을 때 */
  onDownloaded: (records: SurveyRecords) => void;
  /** 내려받지 않은 기록이 있는지 */
  unsaved: boolean;
  /** 방문 순서에서 from번째 필지를 to번째 자리로 옮긴다 (0부터, 출발지 줄 제외) */
  onMove: (from: number, to: number) => void;
  /** 바꾼 순서의 새 구간 시간을 길찾기로 확인하는 중인지 */
  refreshing: boolean;
  /** 여러 날로 나눈 경우: 일차별 동선, 지금 보는 일차(0부터), 첫날 날짜 (나누지 않았으면 null) */
  days: { plans: RoutePlan[]; index: number; startDate: string; fullCount: number } | null;
  /** 나누기 전 전체 필지 수 */
  fullCount: number;
  onSplit: () => void;
  onMerge: () => void;
  onSelectDay: (index: number) => void;
  /** 조사 지역의 날씨 예보 (가져오는 중이거나 가져오지 못했을 수 있다) */
  weather: WeatherState;
  /** 결과를 만든 뒤 설정을 바꿨으면 true (아래 결과가 이전 설정 기준임을 알린다) */
  stale: boolean;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const byId = new Map(parcels.map((p) => [p.id, p]));
  const parcelCount = plan.orderIds.length;
  const endClock =
    plan.returnMinutes !== undefined
      ? plan.returnMinutes
      : parcelCount > 0
        ? plan.arrivalMinutes[parcelCount - 1] + settings.inspectMinutes
        : plan.departMinutes;

  /** i번째 방문 필지로 가는 길찾기 링크 (앞 지점이나 이 필지의 위치를 모르면 없음) */
  function directionsFor(i: number): string | undefined {
    const to = byId.get(plan.orderIds[i]);
    const before = i === 0 ? undefined : byId.get(plan.orderIds[i - 1]);
    const from = i === 0 ? { name: "출발지", coord: settings.origin.coord } : before?.coord ? { name: before.address, coord: before.coord } : undefined;
    if (!to?.coord || !from) return undefined;
    return kakaoDirectionsUrl(settings.mode, from, { name: to.address, coord: to.coord });
  }

  // 표의 한 줄 = "이 지점에서 다음 지점까지". 0번 줄은 출발지, 1~n번 줄은 방문할 필지
  const rows = [
    {
      key: "origin",
      order: 0,
      label: `출발지 · ${settings.origin.address}`,
      clock: `${formatClock(plan.departMinutes)} 출발`,
      leg: plan.legs[0],
      arrival: undefined as (typeof plan.legs)[number] | undefined,
      note: undefined as string | undefined,
      directionsUrl: undefined as string | undefined,
    },
    ...plan.orderIds.map((id, i) => ({
      key: id,
      order: i + 1,
      label: byId.get(id)?.address ?? id,
      clock: `${formatClock(plan.arrivalMinutes[i])} 도착`,
      leg: plan.legs[i + 1],
      /** 이 필지에 도착하는 구간 (도로 끝에서 도보 이동이 필요한지는 도착 구간에 담겨 있다) */
      arrival: plan.legs[i],
      note: i === parcelCount - 1 && plan.legs[i + 1] ? "→ 출발지로 돌아오기" : undefined,
      /** 바로 앞 지점(출발지 또는 앞 필지)에서 이 필지까지의 카카오맵 길찾기 링크 */
      directionsUrl: directionsFor(i),
    })),
  ];

  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      {stale && (
        <p role="status" className="rounded border border-amber-500 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          ⚠ 설정을 바꿨어요. 아래 결과는 이전 설정({MODE_LABELS[settings.mode]} · {settings.date} · {settings.departTime} 출발 · 필지당 {settings.inspectMinutes}분)으로 만든 거예요.
          바뀐 설정으로 보려면 왼쪽의 &apos;동선 만들기&apos;를 다시 눌러 주세요.
        </p>
      )}
      {parcelCount > 0 && <WeatherNotice weather={weather} date={settings.date} mode={settings.mode} />}

      {days ? (
        <div className="no-print space-y-1">
          <div role="tablist" aria-label="일차 선택" className="flex flex-wrap items-center gap-1">
            {days.plans.map((d, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === days.index}
                onClick={() => onSelectDay(i)}
                className={`rounded border px-2 py-1 text-xs ${
                  i === days.index ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-400"
                }`}
              >
                {i + 1}일차 · {addDaysToDate(days.startDate, i).slice(5).replace("-", "/")} · {d.orderIds.length}곳 · {formatDuration(d.totalMinutes)}
              </button>
            ))}
            <button type="button" onClick={onMerge} className="ml-2 rounded border border-zinc-400 px-2 py-1 text-xs underline">
              하나로 합치기
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            전체 최단 순서를 하루 {PARCELS_PER_DAY}곳씩 끊어 {days.plans.length}일로 나눴어요. 하루마다 출발지에서 시작하고, 조사 날짜부터 하루씩 이어서 잡았어요(주말도 건너뛰지 않아요).
            엑셀·인쇄는 지금 보는 일차 기준이에요.
          </p>
        </div>
      ) : (
        fullCount > PARCELS_PER_DAY && (
          <div className="no-print flex flex-wrap items-center gap-2 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs dark:bg-blue-950/30">
            <span>필지가 {fullCount}곳이에요. 하루에 {PARCELS_PER_DAY}곳씩 나누면 {Math.ceil(fullCount / PARCELS_PER_DAY)}일 일정이 돼요.</span>
            <button type="button" onClick={onSplit} disabled={refreshing} className="rounded border border-blue-600 px-2 py-1 font-medium text-blue-700 disabled:opacity-50 dark:text-blue-300">
              여러 날로 나누기
            </button>
          </div>
        )
      )}
      {parcelCount > 0 && (
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-base font-semibold">
          총 {formatDuration(plan.totalMinutes)}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            (이동 {formatDuration(plan.travelMinutes)} + 조사 {formatDuration(plan.inspectMinutes)})
          </span>
        </p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {days && `${days.index + 1}일차 / 총 ${days.plans.length}일 · `}{settings.date} · {MODE_LABELS[settings.mode]} · {END_MODE_LABELS[settings.endMode]} · 필지당 {settings.inspectMinutes}분
        </p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {plan.returnMinutes !== undefined ? "출발지 복귀" : "조사 끝"} 예정 {formatClock(endClock)}
        </p>
      </div>
      )}

      <div className="no-print flex flex-wrap items-center gap-2">
        <ExportButton settings={settings} plan={plan} parcels={parcels} excluded={excluded} records={records} onDownloaded={onDownloaded} />
        <button
          type="button"
          onClick={() => window.print()}
          disabled={parcelCount === 0}
          className="rounded border border-zinc-400 px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          인쇄하기
        </button>
        <span className="text-xs text-zinc-500">결과표만 A4 가로 한 장으로 인쇄돼요. (인쇄 창에서 PDF로 저장도 가능)</span>
      </div>
      {unsaved && (
        <p role="note" className="no-print text-xs text-red-600 dark:text-red-400">
          ⚠ 아직 엑셀로 내려받지 않은 조사 기록이 있어요. 창을 닫으면 사라져요.
        </p>
      )}

      {plan.legs.length > 0 && plan.estimatedLegCount === plan.legs.length && (
        <p role="note" className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">
          <strong>⚠ 추정값</strong> — {notice} 직선거리(×1.3)와 평균 속도로 계산했어요. 실제 시간과 거리는 다를 수 있어요.
        </p>
      )}
      {plan.estimatedLegCount > 0 && plan.estimatedLegCount < plan.legs.length && (
        <p role="note" className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">
          <strong>⚠ 일부 추정값</strong> — {plan.legs.length}개 구간 중 {plan.estimatedLegCount}개는 길찾기 결과를 얻지 못해 직선거리로 추정했어요. 표의 &apos;추정값&apos; 표시를 확인해 주세요.
        </p>
      )}
      {plan.legs.length > 0 && plan.estimatedLegCount < plan.legs.length && settings.mode === "car" && (
        <p className="text-xs text-zinc-500">
          카카오 길찾기 기준이에요. 시간은 지금의 교통 상황 기준이고, 조사 날짜·출발 시각의 교통 상황은 반영하지 않았어요.
        </p>
      )}
      {plan.legs.length > 0 && plan.estimatedLegCount < plan.legs.length && settings.mode === "transit" && (
        <p className="text-xs text-zinc-500">
          방문 순서는 직선거리로 정했고, 구간별 시간(걷는 시간·환승 포함)과 환승 횟수는 카카오 대중교통 길찾기로 확인했어요.
          지금 운행 중인 노선 기준이고, 조사 날짜·출발 시각의 운행 시간표는 반영하지 않았어요.
        </p>
      )}
      {plan.legs.length > 0 && plan.estimatedLegCount < plan.legs.length && settings.mode === "walk" && (
        <p className="text-xs text-zinc-500">
          방문 순서는 걷는 거리가 짧도록 직선거리로 정했고, 구간별 걷는 시간과 거리는 카카오 길찾기로 확인했어요.
        </p>
      )}
      {plan.manual ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          방문 순서를 직접 바꿨어요. 최단 순서가 아닐 수 있고, 시각과 총 소요 시간은 바꾼 순서로 다시 계산했어요.
          {refreshing && " 새 구간의 시간을 확인하는 중이에요…"}
        </p>
      ) : (
        !plan.exact && <p className="text-xs text-zinc-500">필지가 13곳 이상이라 최단에 가까운 순서로 계산했어요. (최단이 아닐 수 있어요)</p>
      )}

      {plan.legs.some((l) => l.roadEndWalk) && (
        <p role="note" className="rounded border border-orange-300 bg-orange-50 px-3 py-2 text-xs dark:bg-orange-950/30">
          <strong>도로 끝에서 도보 이동 필요</strong> — 표시된 필지는 차가 들어갈 수 있는 도로 끝까지의 시간만 계산했어요.
          도로 끝에서 필지까지 걷는 시간은 포함하지 않았어요.
        </p>
      )}

      {parcelCount === 0 ? (
        <p className="text-zinc-500">
          {excluded.length > 0
            ? "고른 필지가 모두 '조사 완료'라서 계산할 필지가 없어요. 다시 조사할 필지는 아래에서 완료 표시를 풀어 주세요."
            : "계산할 필지가 없어요."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <p className="no-print mb-1 text-xs text-zinc-500">{MEMO_PRIVACY_NOTICE}</p>
          <datalist id="usage-suggestions">
            {USAGE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <table className="w-full min-w-[60rem] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-300 dark:border-zinc-700">
                <th className="no-print w-16 py-1 pr-1 font-medium">순서 바꾸기</th>
                <th className="w-12 py-1 pr-2 font-medium">순번</th>
                <th className="py-1 pr-2 font-medium">지번 주소</th>
                <th className="w-24 py-1 pr-2 font-medium">시각</th>
                <th className="w-24 py-1 pr-2 text-right font-medium">다음까지 (km)</th>
                <th className="w-24 py-1 pr-2 text-right font-medium">다음까지 (분)</th>
                {settings.mode === "transit" && <th className="w-14 py-1 pr-2 text-right font-medium">환승</th>}
                {settings.mode === "transit" && <th className="w-64 py-1 pr-2 font-medium">이용 노선</th>}
                <th className="w-28 py-1 pr-2 font-medium">표시</th>
                <th className="w-14 py-1 pr-2 font-medium">조사 완료</th>
                <th className="w-32 py-1 pr-2 font-medium">이용 현황</th>
                <th className="w-48 py-1 font-medium">메모</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-zinc-200 align-top dark:border-zinc-800 ${
                    row.order > 0 && dragOver === row.order - 1 && dragFrom !== null && dragFrom !== row.order - 1 ? "bg-blue-50 dark:bg-blue-950/30" : ""
                  }`}
                  draggable={row.order > 0 && !refreshing}
                  onDragStart={(e) => {
                    if (row.order === 0) return;
                    // 입력 칸 안에서 글자를 끌어 선택하는 동작은 순서 바꾸기로 보지 않는다
                    if ((e.target as HTMLElement).closest("input")) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(row.order - 1));
                    setDragFrom(row.order - 1);
                  }}
                  onDragOver={(e) => {
                    if (dragFrom === null || row.order === 0) return;
                    e.preventDefault();
                    setDragOver(row.order - 1);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null && row.order > 0 && dragFrom !== row.order - 1) onMove(dragFrom, row.order - 1);
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                >
                  <td className="no-print py-1 pr-1 whitespace-nowrap">
                    {row.order > 0 && (
                      <>
                        <span aria-hidden className="mr-1 cursor-grab select-none text-zinc-400" title="끌어서 순서 바꾸기">⠿</span>
                        <button
                          type="button"
                          onClick={() => onMove(row.order - 1, row.order - 2)}
                          disabled={row.order === 1 || refreshing}
                          aria-label={`${row.label} 한 칸 위로`}
                          className="rounded border border-zinc-300 px-1 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => onMove(row.order - 1, row.order)}
                          disabled={row.order === parcelCount || refreshing}
                          aria-label={`${row.label} 한 칸 아래로`}
                          className="ml-0.5 rounded border border-zinc-300 px-1 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </>
                    )}
                  </td>
                  <td className="py-1 pr-2">{row.order === 0 ? "0" : row.order}</td>
                  <td className="py-1 pr-2">
                    {row.directionsUrl ? (
                      <a
                        href={row.directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="카카오맵에서 이 필지까지 길찾기 열기"
                        className="text-blue-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-blue-300"
                      >
                        {row.label}
                      </a>
                    ) : (
                      row.label
                    )}
                    {row.note && <span className="ml-1 text-zinc-500">{row.note}</span>}
                  </td>
                  <td className="py-1 pr-2 text-zinc-600 dark:text-zinc-400">{row.clock}</td>
                  <td className="py-1 pr-2 text-right">{row.leg ? row.leg.distanceKm.toFixed(1) : "-"}</td>
                  <td className="py-1 pr-2 text-right">{row.leg ? row.leg.minutes : "-"}</td>
                  {settings.mode === "transit" && (
                    <td className="py-1 pr-2 text-right">{row.leg?.transfers !== undefined ? `${row.leg.transfers}회` : "-"}</td>
                  )}
                  {settings.mode === "transit" && (
                    <td className="py-1 pr-2 text-xs">
                      {legRideTexts(row.leg).length > 0 ? (
                        <ul className="space-y-0.5">
                          {legRideTexts(row.leg).map((text, i) => (
                            <li key={i}>{text}</li>
                          ))}
                        </ul>
                      ) : (
                        "-"
                      )}
                    </td>
                  )}
                  <td className="space-x-1 py-1 pr-2">
                    {row.arrival?.roadEndWalk && (
                      <span className="rounded bg-orange-100 px-1 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                        도로 끝에서 도보 이동 필요
                        {row.arrival.roadEndMeters !== undefined && ` (약 ${row.arrival.roadEndMeters}m)`}
                      </span>
                    )}
                    {row.leg?.walkFallback && (
                      <span className="rounded bg-sky-100 px-1 text-sky-800 dark:bg-sky-900 dark:text-sky-200">도보 구간</span>
                    )}
                    {row.leg?.estimated && (
                      <span className="rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-900 dark:text-amber-200">추정값</span>
                    )}
                  </td>
                  {row.order === 0 ? (
                    <td colSpan={3} className="py-1 text-zinc-400">-</td>
                  ) : (
                    <RecordCells
                      address={row.label}
                      record={getRecord(records, row.key)}
                      onChange={(change) => onRecordChange(row.key, change)}
                    />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {excluded.length > 0 && (
        <div className="no-print overflow-x-auto">
          <h3 className="mb-1 text-xs font-semibold">조사 완료로 계산에서 뺀 필지 ({excluded.length}곳)</h3>
          <p className="mb-1 text-xs text-zinc-500">
            완료 표시를 풀고 &apos;동선 만들기&apos;를 다시 누르면 이 필지도 다시 계산에 들어가요. 입력한 기록은 그대로 남아 있어요.
          </p>
          <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
            <tbody>
              {excluded.map((p) => (
                <tr key={p.id} className="border-b border-zinc-200 align-top dark:border-zinc-800">
                  <td className="py-1 pr-2">{p.address}</td>
                  <RecordCells address={p.address} record={getRecord(records, p.id)} onChange={(change) => onRecordChange(p.id, change)} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
