// Design Ref: §4 SurveyRecord — 조사 기록(nice 1). 화면 상태에만 두고 서버에는 저장하지 않는다.

export type SurveyRecord = { parcelId: string; done: boolean; usage: string; memo: string };

/** 필지 id → 조사 기록 (기록이 없는 필지는 키가 없다) */
export type SurveyRecords = Record<string, SurveyRecord>;

/** 이용 현황 칸에 보여 줄 입력 예시 (자유롭게 직접 써도 된다) */
export const USAGE_SUGGESTIONS = ["자가 이용", "임대 중", "무단 점유", "공실·나대지", "확인 불가"];

/** 메모 칸 아래에 보여 줄 개인정보 금지 안내 */
export const MEMO_PRIVACY_NOTICE =
  "메모에는 이름·전화번호·주민등록번호 같은 개인정보를 적지 마세요. 입력한 기록은 서버에 저장되지 않고, 엑셀로 내려받을 때만 파일에 담겨요.";

export const MAX_USAGE_LENGTH = 100;
export const MAX_MEMO_LENGTH = 500;

const emptyRecord = (parcelId: string): SurveyRecord => ({ parcelId, done: false, usage: "", memo: "" });

/** 기록 하나를 바꾼다. 원본은 건드리지 않고, 아무 내용도 없게 되면 기록을 지운다. */
export function updateRecord(
  records: SurveyRecords,
  parcelId: string,
  change: Partial<Omit<SurveyRecord, "parcelId">>,
): SurveyRecords {
  const next: SurveyRecord = { ...(records[parcelId] ?? emptyRecord(parcelId)), ...change };
  next.usage = next.usage.slice(0, MAX_USAGE_LENGTH);
  next.memo = next.memo.slice(0, MAX_MEMO_LENGTH);
  const rest = { ...records };
  if (!next.done && next.usage === "" && next.memo === "") {
    delete rest[parcelId];
    return rest;
  }
  return { ...rest, [parcelId]: next };
}

/** 기록이 없는 필지도 빈 기록으로 읽을 수 있게 한다 */
export function getRecord(records: SurveyRecords, parcelId: string): SurveyRecord {
  return records[parcelId] ?? emptyRecord(parcelId);
}

/** 입력한 내용이 하나라도 있는 기록 수 */
export function countRecords(records: SurveyRecords): number {
  return Object.keys(records).length;
}

/** "조사 완료"로 표시한 필지 id 목록 (작업 29에서 다시 계산할 때 제외하는 데 쓴다) */
export function doneIds(records: SurveyRecords): string[] {
  return Object.values(records)
    .filter((r) => r.done)
    .map((r) => r.parcelId);
}

/** 기록을 비교하기 위한 글자 (내려받은 시점의 기록과 지금 기록이 같은지 보는 데 쓴다) */
export function snapshotRecords(records: SurveyRecords): string {
  return JSON.stringify(
    Object.values(records)
      .sort((a, b) => a.parcelId.localeCompare(b.parcelId))
      .map((r) => [r.parcelId, r.done, r.usage, r.memo]),
  );
}

/** 엑셀로 내려받지 않은 기록이 있는지: 기록이 있고, 마지막으로 내려받은 때의 기록과 다르면 true */
export function hasUnsavedRecords(records: SurveyRecords, savedSnapshot: string): boolean {
  return countRecords(records) > 0 && snapshotRecords(records) !== savedSnapshot;
}

/** 창을 닫으려 할 때 띄우는 경고 문구 (브라우저에 따라 이 문구 대신 기본 문구가 보일 수 있다) */
export const UNSAVED_WARNING = "저장하지 않은 기록이 있어요. 엑셀로 내려받지 않고 나가면 입력한 기록이 사라져요.";

/** 동선에 넣을 필지와, "조사 완료"라서 이번 계산에서 빼는 필지로 나눈다 (원래 순서 유지). 기록은 건드리지 않는다. */
export function splitDone<T extends { id: string }>(parcels: readonly T[], records: SurveyRecords): { active: T[]; excluded: T[] } {
  const done = new Set(doneIds(records));
  return { active: parcels.filter((p) => !done.has(p.id)), excluded: parcels.filter((p) => done.has(p.id)) };
}
