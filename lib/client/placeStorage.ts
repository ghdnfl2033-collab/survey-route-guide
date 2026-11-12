// 출발지 기록·즐겨찾기는 이 컴퓨터의 브라우저에만 저장한다 (서버로 보내지 않음). 주소와 좌표만 저장한다.

import { EMPTY_PLACES, parseStoredPlaces, type StoredPlaces } from "@/lib/core/places";

const KEY = "survey-places-v1";

/** 저장된 출발지 기록·즐겨찾기를 읽는다. 저장소를 쓸 수 없거나 내용이 깨졌으면 빈 목록이다. */
export function loadPlaces(): StoredPlaces {
  try {
    return parseStoredPlaces(window.localStorage.getItem(KEY));
  } catch {
    return EMPTY_PLACES;
  }
}

/** 저장한다. 저장하지 못하면 false (브라우저가 저장을 막은 경우 등). */
export function savePlaces(places: StoredPlaces): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(places));
    return true;
  } catch {
    return false;
  }
}
