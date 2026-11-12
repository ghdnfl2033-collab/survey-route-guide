// Design Ref: §4 ParcelGroup — 필지 묶음은 이 컴퓨터의 브라우저에만 저장한다 (서버로 보내지 않음). 주소와 좌표만 저장한다.

import { parseStoredGroups, type ParcelGroup } from "@/lib/core/groups";

const KEY = "survey-parcel-groups-v1";

/** 저장된 묶음을 읽는다. 저장소를 쓸 수 없거나 내용이 깨졌으면 빈 목록이다. */
export function loadGroups(): ParcelGroup[] {
  try {
    return parseStoredGroups(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

/** 묶음 목록을 저장한다. 저장하지 못하면 false (브라우저가 저장을 막은 경우 등). */
export function saveGroups(groups: readonly ParcelGroup[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(groups));
    return true;
  } catch {
    return false;
  }
}
