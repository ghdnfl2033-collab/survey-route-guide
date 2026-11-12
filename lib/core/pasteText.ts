// 붙여넣은 글자를 주소 목록으로 바꾼다 (순수 계산)
// Plan SC: PRD 5장 must 1 — 엑셀과 같은 규칙: 한 줄에 주소 하나, 빈 줄 건너뜀, 같은 주소는 하나로 합침,
//          여러 열을 복사해 붙여도 첫 번째 열만 읽는다 (다른 열은 읽지 않음).

import { addressKey, mergeDuplicateAddresses, type MergedAddress } from "./address";
import { readAddressColumn } from "./excelRules";

/** 한 번에 붙여넣을 수 있는 최대 줄 수 */
export const MAX_PASTE_LINES = 1000;

export type PasteResult =
  | { ok: false; message: string }
  | {
      ok: true;
      /** 새로 추가할 주소 (붙여넣은 안에서 합친 뒤, 이미 목록에 있는 주소는 뺀 것) */
      parcels: MergedAddress[];
      /** 붙여넣은 주소 안에서 겹쳐 합친 건수 */
      mergedCount: number;
      /** 이미 목록에 있어서 건너뛴 주소 수 */
      alreadyCount: number;
      blankCount: number;
      /** 주소로 읽지 못한 줄 번호 (붙여넣은 글자 기준, 1부터) */
      unreadableLines: number[];
    };

/**
 * @param text 붙여넣은 글자
 * @param existing 이미 목록에 있는 주소들 (같은 주소는 건너뜀)
 * @param startRow 새 주소에 붙일 "원본 줄 번호"의 시작 값 (기존 필지의 번호와 겹치지 않게)
 */
export function parsePastedText(text: string, existing: readonly string[], startRow: number): PasteResult {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > MAX_PASTE_LINES + 1 && lines.slice(MAX_PASTE_LINES).some((l) => l.trim() !== "")) {
    return { ok: false, message: `한 번에 ${MAX_PASTE_LINES}줄까지만 붙여넣을 수 있어요. 나눠서 붙여넣어 주세요.` };
  }

  // 첫 번째 칸(탭 앞)만 읽는다. 엑셀에서 여러 열을 복사하면 칸이 탭으로 이어져 온다.
  const cells = lines.map((line) => line.split("\t")[0]);
  const read = readAddressColumn(cells);
  if (read.addresses.length === 0) {
    return { ok: false, message: "읽을 수 있는 주소가 없어요. 한 줄에 주소 하나씩 붙여넣어 주세요." };
  }

  const merged = mergeDuplicateAddresses(read.addresses.map((a) => ({ row: startRow + a.row, address: a.address })));
  const known = new Set(existing.map(addressKey));
  const parcels = merged.parcels.filter((p) => !known.has(p.address));

  return {
    ok: true,
    parcels,
    mergedCount: merged.mergedCount,
    alreadyCount: merged.parcels.length - parcels.length,
    blankCount: read.blankCount,
    unreadableLines: read.unreadableRows,
  };
}
