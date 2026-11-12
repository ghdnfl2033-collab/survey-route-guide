// Design Ref: §4.2 ① — 엑셀 첫 열을 지번 주소로 읽는 규칙 (화면·파일 읽기와 무관한 순수 계산)
// Plan SC: PRD 5장 must 1 — 제목 행 없음, 첫 열만, 빈 줄 건너뜀, 못 읽은 줄 번호 안내

/** 주소 한 칸의 최대 글자 수 (이보다 길면 주소가 아닌 값으로 보고 읽지 못한 줄로 처리) */
export const MAX_ADDRESS_LENGTH = 200;

export type ReadAddress = {
  /** 엑셀에서의 원래 줄 번호 (1부터, 빈 줄도 센다) */
  row: number;
  address: string;
};

export type ColumnReadResult = {
  addresses: ReadAddress[];
  /** 건너뛴 빈 줄 수 */
  blankCount: number;
  /** 읽지 못한 줄 번호 (숫자·날짜·오류 값이거나 너무 긴 칸) */
  unreadableRows: number[];
};

/**
 * 첫 번째 열의 칸 값들(위에서부터 1번째 줄)을 주소 목록으로 바꾼다.
 * - 문자열: 앞뒤 공백을 지우고 비어 있으면 빈 줄, 아니면 주소
 * - 그 밖의 값(숫자·날짜·참/거짓·오류)이나 너무 긴 글: 읽지 못한 줄
 * - 비어 있는 칸(null·undefined): 빈 줄
 */
export function readAddressColumn(cells: readonly unknown[]): ColumnReadResult {
  const addresses: ReadAddress[] = [];
  const unreadableRows: number[] = [];
  let blankCount = 0;

  cells.forEach((cell, index) => {
    const row = index + 1;

    if (cell === null || cell === undefined) {
      blankCount += 1;
      return;
    }
    if (typeof cell !== "string") {
      unreadableRows.push(row);
      return;
    }

    const address = cell.trim();
    if (address === "") {
      blankCount += 1;
    } else if (address.length > MAX_ADDRESS_LENGTH) {
      unreadableRows.push(row);
    } else {
      addresses.push({ row, address });
    }
  });

  // 파일 맨 끝의 빈 줄은 "건너뛴 빈 줄"로 세지 않는다 (엑셀이 끝에 남기는 빈 칸이라 사용자에게 의미가 없음)
  let trailing = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (c === null || c === undefined || (typeof c === "string" && c.trim() === "")) trailing += 1;
    else break;
  }
  blankCount -= trailing;

  return { addresses, blankCount, unreadableRows };
}
