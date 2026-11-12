import { describe, expect, it, vi } from "vitest";
import { applyRetryResults, buildParcels, isInKorea, setManualLocation } from "@/lib/core/parcels";
import { GEOCODE_BATCH_SIZE, GeocodeRequestError, geocodeAddresses } from "@/lib/client/geocode";
import type { GeocodeItem } from "@/lib/core/types";

const merged = [
  { address: "A", rowNumbers: [1, 4] },
  { address: "B", rowNumbers: [2] },
  { address: "C", rowNumbers: [3] },
];
const found = (address: string): GeocodeItem => ({ address, status: "found", coord: { lat: 37, lng: 127 } });

describe("buildParcels — 필지 만들기", () => {
  it("찾은 필지는 좌표를 갖고, 못 찾은 필지는 짐작하지 않고 확인 필요로 둔다", () => {
    const parcels = buildParcels(merged, [
      found("A"),
      { address: "B", status: "notFound" },
      { address: "C", status: "error" },
    ]);
    expect(parcels[0]).toMatchObject({ id: "p-1", address: "A", rowNumbers: [1, 4], needsCheck: false, coordSource: "kakao" });
    expect(parcels[0].coord).toEqual({ lat: 37, lng: 127 });
    expect(parcels[1]).toMatchObject({ needsCheck: true, lookupFailed: false });
    expect(parcels[1].coord).toBeUndefined();
    expect(parcels[2]).toMatchObject({ needsCheck: true, lookupFailed: true });
    expect(parcels[2].coord).toBeUndefined();
  });

  it("결과가 모자라면 해당 필지는 일시 오류로 확인 필요가 된다", () => {
    const parcels = buildParcels(merged, [found("A")]);
    expect(parcels[1]).toMatchObject({ needsCheck: true, lookupFailed: true });
  });
});

describe("applyRetryResults — 다시 찾기", () => {
  it("다시 찾은 결과만 반영하고, 이미 위치가 있는 필지는 그대로 둔다", () => {
    const first = buildParcels(merged, [found("A"), { address: "B", status: "error" }, { address: "C", status: "notFound" }]);
    const next = applyRetryResults(first, [found("B"), found("A")]);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toMatchObject({ needsCheck: false, coordSource: "kakao" });
    expect(next[2]).toBe(first[2]);
  });
});

describe("setManualLocation — 지도에서 직접 찍은 위치", () => {
  const base = buildParcels(merged, [found("A"), { address: "B", status: "notFound" }, { address: "C", status: "error" }]);

  it("확인 필요 필지에 위치를 넣으면 확인 필요에서 빠지고 출처가 manual이 된다", () => {
    const next = setManualLocation(base, "p-2", { lat: 35.1, lng: 129.0 });
    expect(next[1]).toMatchObject({ needsCheck: false, lookupFailed: false, coordSource: "manual", coord: { lat: 35.1, lng: 129.0 } });
  });

  it("다른 필지는 그대로 둔다", () => {
    const next = setManualLocation(base, "p-2", { lat: 35.1, lng: 129.0 });
    expect(next[0]).toBe(base[0]);
    expect(next[2]).toBe(base[2]);
  });

  it("이미 찍은 위치를 다시 찍으면 새 위치로 바뀐다", () => {
    const once = setManualLocation(base, "p-2", { lat: 35.1, lng: 129.0 });
    const twice = setManualLocation(once, "p-2", { lat: 36.0, lng: 128.0 });
    expect(twice[1].coord).toEqual({ lat: 36.0, lng: 128.0 });
  });

  it("대한민국 밖이거나 숫자가 아니면 위치를 넣지 않는다", () => {
    for (const coord of [{ lat: 0, lng: 0 }, { lat: 40.7, lng: -74 }, { lat: NaN, lng: 127 }]) {
      const next = setManualLocation(base, "p-2", coord);
      expect(next[1].coord).toBeUndefined();
      expect(next[1].needsCheck).toBe(true);
    }
  });

  it("없는 필지 id면 아무것도 바꾸지 않는다", () => {
    expect(setManualLocation(base, "p-999", { lat: 35, lng: 129 })).toEqual(base);
  });

  it("isInKorea: 제주·독도·서울은 안, 도쿄·베이징은 밖", () => {
    expect(isInKorea({ lat: 33.5, lng: 126.5 })).toBe(true);
    expect(isInKorea({ lat: 37.24, lng: 131.87 })).toBe(true);
    expect(isInKorea({ lat: 37.57, lng: 126.98 })).toBe(true);
    expect(isInKorea({ lat: 35.68, lng: 139.69 })).toBe(false);
    expect(isInKorea({ lat: 39.9, lng: 116.4 })).toBe(false);
  });
});

describe("geocodeAddresses — 서버에 100건씩 나눠 요청", () => {
  const okFetch = () =>
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { addresses } = JSON.parse(String(init?.body)) as { addresses: string[] };
      return new Response(JSON.stringify({ results: addresses.map(found) }), { status: 200 });
    });

  it("250건이면 100·100·50건으로 3번 나눠 보내고 순서를 유지한다", async () => {
    const f = okFetch();
    const addrs = Array.from({ length: 250 }, (_, i) => `주소${i}`);
    const progress: number[] = [];
    const r = await geocodeAddresses(addrs, (done) => progress.push(done), f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.map((x) => x.address)).toEqual(addrs);
    expect(progress).toEqual([0, 100, 200, 250]);
    expect(GEOCODE_BATCH_SIZE).toBe(100);
  });

  it("서버로 주소 글자만 보낸다", async () => {
    const f = okFetch();
    await geocodeAddresses(["서울 1-1"], undefined, f as unknown as typeof fetch);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ addresses: ["서울 1-1"] });
  });

  it("401이면 다시 입장해야 한다는 오류", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(geocodeAddresses(["A"], undefined, f)).rejects.toMatchObject({ unauthorized: true });
  });

  it("서버가 안내 문구를 주면 그대로 보여 준다", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "카카오맵 설정을 확인해 주세요" } }), { status: 502 }));
    await expect(geocodeAddresses(["A"], undefined, f)).rejects.toThrow("카카오맵 설정을 확인해 주세요");
  });

  it("네트워크가 끊기면 연결 안내 오류", async () => {
    const f = vi.fn().mockRejectedValue(new Error("net"));
    await expect(geocodeAddresses(["A"], undefined, f)).rejects.toBeInstanceOf(GeocodeRequestError);
  });

  it("결과 개수가 어긋나면 오류", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await expect(geocodeAddresses(["A"], undefined, f)).rejects.toBeInstanceOf(GeocodeRequestError);
  });
});

import { removeParcels } from "@/lib/core/parcels";

describe("필지 삭제", () => {
  const p = (id: string) => ({ id, address: id, rowNumbers: [1], needsCheck: false });
  it("지정한 필지만 빼고 순서는 그대로 둔다", () => {
    expect(removeParcels([p("a"), p("b"), p("c")], ["b"]).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("없는 id나 빈 목록이면 그대로", () => {
    expect(removeParcels([p("a")], ["zz"])).toHaveLength(1);
    expect(removeParcels([p("a")], [])).toHaveLength(1);
  });
});
