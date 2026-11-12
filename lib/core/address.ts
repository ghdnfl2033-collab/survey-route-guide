// Design Ref: §4.2 ② — 같은 주소를 하나로 합친다 (순수 계산)
// Plan SC: PRD 5장 must 1 — 같은 주소가 2번 이상 나오면 하나로 합치고, 합쳤다는 사실을 알린다

import type { ReadAddress } from "./excelRules";

export type MergedAddress = {
  /** 화면·엑셀에 보여 줄 원문 (처음 나온 줄의 주소, 앞뒤 공백만 정리됨) */
  address: string;
  /** 이 주소가 나온 엑셀 줄 번호들 (합쳐졌으면 여러 개) */
  rowNumbers: number[];
};

export type MergeResult = {
  parcels: MergedAddress[];
  /** 합쳐서 없어진 줄 수 (예: 같은 주소가 3번 나왔으면 2) */
  mergedCount: number;
};

/**
 * 같은 주소인지 판단하는 열쇠.
 * 연속 공백(전각 공백 포함)을 한 칸으로 줄이고 앞뒤 공백을 지운 값이 같으면 같은 주소로 본다.
 * 괄호나 "산" 표기는 바꾸지 않는다 — 서로 다른 주소가 합쳐지는 일을 막기 위해서다.
 */
export function addressKey(address: string): string {
  return address.replace(/\s+/g, " ").trim();
}

/** 같은 주소를 하나로 합친다. 처음 나온 순서를 유지한다. */
export function mergeDuplicateAddresses(addresses: readonly ReadAddress[]): MergeResult {
  const byKey = new Map<string, MergedAddress>();

  for (const { row, address } of addresses) {
    const key = addressKey(address);
    const found = byKey.get(key);
    if (found) {
      found.rowNumbers.push(row);
    } else {
      byKey.set(key, { address: key, rowNumbers: [row] });
    }
  }

  const parcels = [...byKey.values()];
  return { parcels, mergedCount: addresses.length - parcels.length };
}
