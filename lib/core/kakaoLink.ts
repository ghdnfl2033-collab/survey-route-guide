// 카카오맵 길찾기 링크 만들기 (https://map.kakao.com/link/by/{수단}/출발지,위도,경도/도착지,위도,경도)
// 눌렀을 때 카카오맵이 새 창에서 출발지·도착지가 채워진 길찾기를 열어 준다. 우리 서버로는 아무것도 보내지 않는다.

import type { Coord, TravelMode } from "./types";

const KAKAO_BY: Record<TravelMode, string> = { car: "car", transit: "traffic", walk: "walk" };

/** 주소 이름에 들어 있으면 링크가 깨지는 글자(쉼표, 슬래시 등)를 공백으로 바꾼다 */
function safeName(name: string): string {
  return name.replace(/[,/\?#%]/g, " ").replace(/\s+/g, " ").trim() || "지점";
}

export function kakaoDirectionsUrl(mode: TravelMode, from: { name: string; coord: Coord }, to: { name: string; coord: Coord }): string {
  const place = (p: { name: string; coord: Coord }) => `${encodeURIComponent(safeName(p.name))},${p.coord.lat},${p.coord.lng}`;
  return `https://map.kakao.com/link/by/${KAKAO_BY[mode]}/${place(from)}/${place(to)}`;
}
