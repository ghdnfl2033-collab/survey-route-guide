import { describe, expect, it, vi } from "vitest";
import { fetchCarLegs, fetchTransitLegs, fetchWalkLegs, RouteLegsError } from "@/lib/client/routeLegs";

const pts = [
  { lat: 37.5, lng: 127 },
  { lat: 37.51, lng: 127.01 },
  { lat: 37.52, lng: 127.02 },
];
const ok = (legs: unknown) => new Response(JSON.stringify({ legs }), { status: 200 });

describe("fetchWalkLegs — 서버에서 도보 구간 값 받기", () => {
  it("좌표와 이동 수단(walk)만 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(ok([{ ok: false, status: null }, { ok: false, status: null }]));
    await fetchWalkLegs(pts, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/route-legs");
    expect(JSON.parse(init.body)).toEqual({ points: pts, mode: "walk" });
  });

  it("성공 구간은 분·km로, 실패 구간은 ok false로 돌려준다 (상태 코드는 버린다)", async () => {
    const f = vi.fn().mockResolvedValue(ok([{ ok: true, minutes: 12.5, km: 0.9 }, { ok: false, status: "TOO_FAR_AWAY" }]));
    expect(await fetchWalkLegs(pts, f as unknown as typeof fetch)).toEqual([{ ok: true, minutes: 12.5, km: 0.9 }, { ok: false }]);
  });

  it("대중교통: transit으로 요청하고, 환승 횟수와 도보 구간 표시를 함께 받는다", async () => {
    const f = vi.fn().mockResolvedValue(
      ok([
        { ok: true, minutes: 30, km: 8, transfers: 1, walk: false },
        { ok: true, minutes: 5, km: 0.3, transfers: 0, walk: true },
      ]),
    );
    const r = await fetchTransitLegs(pts, f as unknown as typeof fetch);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ points: pts, mode: "transit" });
    expect(r).toEqual([
      { ok: true, minutes: 30, km: 8, transfers: 1 },
      { ok: true, minutes: 5, km: 0.3, transfers: 0, walkFallback: true },
    ]);
  });

  it("자차: car로 요청하고, 도로 끝까지의 거리(endGapMeters)를 함께 받는다", async () => {
    const f = vi.fn().mockResolvedValue(ok([{ ok: true, minutes: 20, km: 9, endGapMeters: 420 }, { ok: false, status: 103 }]));
    const r = await fetchCarLegs(pts, f as unknown as typeof fetch);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ points: pts, mode: "car" });
    expect(r).toEqual([{ ok: true, minutes: 20, km: 9, endGapMeters: 420 }, { ok: false }]);
  });

  it("401이면 다시 입장해야 한다는 오류", async () => {
    await expect(fetchWalkLegs(pts, vi.fn().mockResolvedValue(new Response("{}", { status: 401 })))).rejects.toMatchObject({ unauthorized: true });
  });

  it("서버가 안내 문구를 주면 그대로 전달한다", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "길찾기 설정을 확인해 주세요" } }), { status: 502 }));
    await expect(fetchWalkLegs(pts, f)).rejects.toThrow("길찾기 설정을 확인해 주세요");
  });

  it("네트워크가 끊기면 연결 안내 오류", async () => {
    await expect(fetchWalkLegs(pts, vi.fn().mockRejectedValue(new Error("net")))).rejects.toBeInstanceOf(RouteLegsError);
  });

  it("응답 모양이 어긋나면 오류 (구간 수·자료형)", async () => {
    const bad = [[], [{ ok: true, minutes: 1, km: 1 }], [{ ok: true, minutes: "1", km: 1 }, { ok: false }], [null, { ok: false }], "x"];
    for (const legs of bad) {
      await expect(fetchWalkLegs(pts, vi.fn().mockResolvedValue(ok(legs)))).rejects.toBeInstanceOf(RouteLegsError);
    }
  });
});
