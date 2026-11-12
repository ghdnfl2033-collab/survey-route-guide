// Design Ref: §5 /api/geocode — 카카오 로컬 API로 지번 주소를 좌표로 바꾼다 (서버 전용, 키는 서버에서만 사용)
// 개인정보: 주소 문자열만 카카오에 보내고, 서버에 저장하거나 로그에 남기지 않는다.

import type { GeocodeItem } from "@/lib/core/types";

export type { GeocodeItem, GeocodeStatus } from "@/lib/core/types";

const KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";
const REQUEST_TIMEOUT_MS = 3000;
/** 카카오에 동시에 보내는 요청 수 (너무 많으면 호출 제한에 걸린다) */
export const GEOCODE_CONCURRENCY = 8;

/** 카카오가 키·서비스 설정 문제로 요청을 거부한 경우 (401·403). 주소 문제가 아니라 설정 문제다. */
export class KakaoAuthError extends Error {
  constructor() {
    super("KAKAO_AUTH");
    this.name = "KakaoAuthError";
  }
}

type KakaoAddressResponse = {
  documents?: { x?: string; y?: string }[];
};

/** 주소 한 건을 좌표로 바꾼다. 못 찾으면 notFound, 네트워크·서버 오류면 error (짐작해서 좌표를 만들지 않는다). */
export async function geocodeAddress(
  address: string,
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeItem> {
  const url = `${KAKAO_ADDRESS_URL}?${new URLSearchParams({ query: address, size: "1" })}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `KakaoAK ${restKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { address, status: "error" };
  }

  if (res.status === 401 || res.status === 403) throw new KakaoAuthError();
  if (!res.ok) return { address, status: "error" };

  let body: KakaoAddressResponse;
  try {
    body = (await res.json()) as KakaoAddressResponse;
  } catch {
    return { address, status: "error" };
  }

  const first = body.documents?.[0];
  const lng = Number(first?.x);
  const lat = Number(first?.y);
  if (!first || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { address, status: "notFound" };
  }
  return { address, status: "found", coord: { lat, lng } };
}

/** 여러 주소를 동시에 최대 limit건씩 변환한다. 입력 순서대로 결과를 돌려준다. */
export async function geocodeMany(
  addresses: readonly string[],
  restKey: string,
  fetchImpl: typeof fetch = fetch,
  limit: number = GEOCODE_CONCURRENCY,
): Promise<GeocodeItem[]> {
  const results: GeocodeItem[] = new Array(addresses.length);
  let next = 0;

  async function worker() {
    while (next < addresses.length) {
      const i = next++;
      results[i] = await geocodeAddress(addresses[i], restKey, fetchImpl);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, addresses.length) }, worker));
  return results;
}
