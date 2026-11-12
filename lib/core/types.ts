// Design Ref: §4.6 — 모든 기능이 공유하는 데이터 모양

export type Coord = { lat: number; lng: number };

/** 필지: 엑셀 첫 열의 지번 주소 한 건 */
export type Parcel = {
  id: string;
  address: string;
  /** 엑셀 원래 줄 번호 (같은 주소가 합쳐지면 여러 개) */
  rowNumbers: number[];
  coord?: Coord;
  /** 카카오가 찾았는지, 사용자가 지도에서 직접 찍었는지 */
  coordSource?: "kakao" | "manual" | "saved";
  /** 위치를 못 찾음 → "확인 필요" 목록 */
  needsCheck: boolean;
  /** 못 찾은 이유가 주소가 아니라 일시적인 오류(네트워크·서버)라서 다시 시도하면 될 수 있음 */
  lookupFailed?: boolean;
};

/** 주소 → 좌표 변환 결과 (found: 찾음, notFound: 못 찾음, error: 일시 오류) */
export type GeocodeStatus = "found" | "notFound" | "error";

export type GeocodeItem = {
  address: string;
  status: GeocodeStatus;
  coord?: Coord;
};

export type TravelMode = "car" | "transit" | "walk";

export type RouteSettings = {
  origin: { address: string; coord: Coord };
  date: string; // YYYY-MM-DD
  departTime: string; // HH:mm
  endMode: "return" | "lastParcel";
  mode: TravelMode;
  inspectMinutes: number; // 기본 10
};

/** 대중교통에서 한 번 타는 구간 (지하철 한 호선이나 버스 한 번) */
export type Ride = {
  /** 예: "2호선", "버스 402" */
  name: string;
  /** 승차·하차 정류장(역) 이름. 응답에 없으면 비어 있음 */
  from?: string;
  to?: string;
  /** 정차 수 (승차에서 하차까지 몇 정거장) */
  stops?: number;
};

/** 결과표의 한 구간 */
export type Leg = {
  from: string; // 필지 id 또는 "origin"
  to: string;
  distanceKm: number;
  minutes: number;
  transfers?: number; // 대중교통만
  lines?: string[]; // 대중교통만: 타는 노선 (예: ["2호선", "버스 402"])
  rides?: Ride[]; // 대중교통만: 노선별 승차·하차 정류장과 정차 수
  estimated: boolean; // "추정값"
  walkFallback: boolean; // "도보 구간"
  roadEndWalk: boolean; // "도로 끝에서 도보 이동 필요" (이 구간의 도착지 필지에 해당)
  /** 도로 끝에서 필지까지의 거리(미터). 모르면 없음 */
  roadEndMeters?: number;
  path?: Coord[];
};

export const MAX_PARCELS_PER_ROUTE = 30;
export const DEFAULT_INSPECT_MINUTES = 10;
