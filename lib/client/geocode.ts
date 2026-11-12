// Design Ref: §4.1 ③ — 주소만 서버(/api/geocode)로 보내 좌표를 받는다. 100건씩 나눠 보낸다.

import type { GeocodeItem } from "@/lib/core/types";

export const GEOCODE_BATCH_SIZE = 100;

export class GeocodeRequestError extends Error {
  /** 접속 코드가 만료되어 다시 입장해야 하는 경우 */
  readonly unauthorized: boolean;
  constructor(message: string, unauthorized = false) {
    super(message);
    this.name = "GeocodeRequestError";
    this.unauthorized = unauthorized;
  }
}

export async function geocodeAddresses(
  addresses: readonly string[],
  onProgress?: (done: number, total: number) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeItem[]> {
  const all: GeocodeItem[] = [];
  onProgress?.(0, addresses.length);

  for (let start = 0; start < addresses.length; start += GEOCODE_BATCH_SIZE) {
    const batch = addresses.slice(start, start + GEOCODE_BATCH_SIZE);

    let res: Response;
    try {
      res = await fetchImpl("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: batch }),
      });
    } catch {
      throw new GeocodeRequestError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
    }

    if (res.status === 401) {
      throw new GeocodeRequestError("접속 시간이 지났어요. 다시 입장해 주세요.", true);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new GeocodeRequestError(body?.error?.message ?? "위치를 찾는 중 문제가 생겼어요.");
    }
    if (!body || !Array.isArray(body.results) || body.results.length !== batch.length) {
      throw new GeocodeRequestError("서버 응답이 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.");
    }

    all.push(...(body.results as GeocodeItem[]));
    onProgress?.(all.length, addresses.length);
  }
  return all;
}
