import { afterEach, describe, expect, it, vi } from "vitest";
import { distanceMeters, offsetCoord } from "@/lib/core/roadEnd";
import { KakaoAuthError } from "@/lib/server/kakao";
import {
  buildCarMatrixWithRoadEnds,
  fetchCarLegs,
  fetchRouteEnd,
  findRoadEnd,
  MAX_ROAD_END_SEARCHES,
  NO_ROAD_CODE,
} from "@/lib/server/kakaoNavi";
import { POST as postMatrix } from "@/app/api/matrix/route";
import { POST as postLegs } from "@/app/api/route-legs/route";
import type { Coord } from "@/lib/core/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const CITY: Coord = { lat: 37.5666, lng: 126.9784 }; // 출발지(서울시청)
/** 산: 이 중심에서 반경 2km 안에는 길이 없고, 도로는 중심에서 북쪽 1km 지점(ROAD)에만 있다. 도로에서 500m 안은 그 도로 끝으로 옮겨 계산한다. */
const MOUNTAIN: Coord = { lat: 37.45, lng: 126.95 };
const ROAD: Coord = offsetCoord(MOUNTAIN, 1000, 0);
const SNAP_M = 500;

/** 도로 끝: 도시 안(산 밖)은 그 지점이 도로, 산 안은 ROAD에서 500m 안일 때만 ROAD로 옮겨 계산, 아니면 도로 없음 */
function roadEndOf(p: Coord): Coord | null {
  if (distanceMeters(p, MOUNTAIN) > 2000) return p;
  return distanceMeters(p, ROAD) <= SNAP_M ? ROAD : null;
}

function fakeKakao(opts: { auth?: boolean } = {}) {
  const calls = { multi: 0, single: 0 };
  const duration = (a: Coord, b: Coord) => Math.round((distanceMeters(a, b) / 1000) * 1.4 * 120);
  const meters = (a: Coord, b: Coord) => Math.round(distanceMeters(a, b) * 1.4);

  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (opts.auth) return json({}, 403);

    if (u.includes("/destinations/directions")) {
      calls.multi++;
      const body = JSON.parse(String(init?.body));
      const o = { lat: body.origin.y, lng: body.origin.x };
      return json({
        routes: body.destinations.map((d: { x: number; y: number; key: string }) => {
          const c = { lat: d.y, lng: d.x };
          if (distanceMeters(o, c) > body.radius) return { key: d.key, result_code: 304 };
          const end = roadEndOf(c);
          if (!end) return { key: d.key, result_code: NO_ROAD_CODE };
          return { key: d.key, result_code: 0, summary: { distance: meters(o, end), duration: duration(o, end) } };
        }),
      });
    }

    calls.single++;
    const q = new URL(u).searchParams;
    const [ox, oy] = q.get("origin")!.split(",").map(Number);
    const [dx, dy] = q.get("destination")!.split(",").map(Number);
    const [o, d] = [{ lat: oy, lng: ox }, { lat: dy, lng: dx }];
    const end = roadEndOf(d);
    if (!end) return json({ routes: [{ result_code: NO_ROAD_CODE, result_msg: "도착 지점 주변의 도로를 탐색할 수 없음" }] });
    return json({
      routes: [
        {
          result_code: 0,
          summary: { distance: meters(o, end), duration: duration(o, end) },
          sections: [{ roads: [{ vertexes: [ox, oy, end.lng, end.lat] }] }],
        },
      ],
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchRouteEnd — 경로 전체의 마지막 좌표(도로 끝)", () => {
  it("성공하면 시간·거리와 도로 끝 좌표를 돌려준다", async () => {
    const k = fakeKakao();
    const target = offsetCoord(ROAD, 300, 90); // 도로에서 300m: 도로 끝으로 옮겨 계산됨
    const r = await fetchRouteEnd(CITY, target, "K", k.fetch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(distanceMeters(r.end, ROAD)).toBeLessThan(1);
      expect(r.minutes).toBeGreaterThan(0);
    }
  });

  it("도로가 없으면 코드 103을 돌려준다", async () => {
    const r = await fetchRouteEnd(CITY, MOUNTAIN, "K", fakeKakao().fetch);
    expect(r).toEqual({ ok: false, code: NO_ROAD_CODE });
  });

  it("401·403은 오류, 서버 오류·이상한 응답은 코드 없는 실패", async () => {
    await expect(fetchRouteEnd(CITY, ROAD, "K", fakeKakao({ auth: true }).fetch)).rejects.toBeInstanceOf(KakaoAuthError);
    expect(await fetchRouteEnd(CITY, ROAD, "K", vi.fn().mockResolvedValue(json({}, 500)) as unknown as typeof fetch)).toEqual({ ok: false, code: null });
    expect(await fetchRouteEnd(CITY, ROAD, "K", vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch)).toEqual({ ok: false, code: null });
    const noVertex = vi.fn(async () => json({ routes: [{ result_code: 0, summary: { distance: 1, duration: 1 }, sections: [] }] })) as unknown as typeof fetch;
    expect(await fetchRouteEnd(CITY, ROAD, "K", noVertex)).toEqual({ ok: false, code: 0 });
  });
});

describe("findRoadEnd — 도로에서 먼 필지의 가장 가까운 도로 지점", () => {
  it("산 한가운데 필지는 가까운 도로 끝과 그 거리를 찾는다", async () => {
    const k = fakeKakao();
    const r = await findRoadEnd(CITY, MOUNTAIN, "K", k.fetch);
    expect(r).not.toBeNull();
    // 도로(ROAD)는 필지에서 북쪽 1000m
    expect(distanceMeters(r!.end, ROAD)).toBeLessThan(1);
    expect(r!.meters).toBeGreaterThan(950);
    expect(r!.meters).toBeLessThan(1050);
  });

  it("가까운 고리에서 찾으면 더 먼 고리는 살피지 않는다", async () => {
    const near = offsetCoord(ROAD, 1000, 90); // 도로에서 1km: 700m 고리 안에서는 안 되고 1500m 고리에서 찾음
    const k = fakeKakao();
    await findRoadEnd(CITY, near, "K", k.fetch);
    const farTarget = offsetCoord(ROAD, 600, 90); // 도로에서 600m: 300m 고리에서 찾을 수 있음
    const k2 = fakeKakao();
    await findRoadEnd(CITY, farTarget, "K", k2.fetch);
    expect(k2.calls.single).toBeLessThanOrEqual(7 * 2); // 한두 고리면 끝
  });

  it("어느 고리에서도 도로가 없으면 null (예: 먼 섬, 사방이 도로 없음)", async () => {
    const none = vi.fn(async () => json({ routes: [{ result_code: NO_ROAD_CODE }] })) as unknown as typeof fetch;
    expect(await findRoadEnd(CITY, MOUNTAIN, "K", none)).toBeNull();
  });

  it("설정 문제면 오류를 던진다", async () => {
    await expect(findRoadEnd(CITY, MOUNTAIN, "K", fakeKakao({ auth: true }).fetch)).rejects.toBeInstanceOf(KakaoAuthError);
  });
});

describe("buildCarMatrixWithRoadEnds — 도로에서 먼 필지가 섞인 시간표", () => {
  const city2 = offsetCoord(CITY, 2000, 90);

  it("도로가 없는 필지(103)는 가까운 도로 지점으로 옮겨 계산하고, 옮긴 거리를 알려 준다", async () => {
    const k = fakeKakao();
    const m = await buildCarMatrixWithRoadEnds([CITY, city2, MOUNTAIN], "K", { fetchImpl: k.fetch });
    expect(m.roadEnds).toHaveLength(1);
    expect(m.roadEnds[0].index).toBe(2);
    expect(m.roadEnds[0].meters).toBeGreaterThan(950);
    expect(distanceMeters({ lat: m.roadEnds[0].lat, lng: m.roadEnds[0].lng }, ROAD)).toBeLessThan(1);
    expect(m.noRoad).toEqual([]);
    // 시간표는 길찾기 결과이고(추정값 아님), 산 필지로 가는 시간도 들어 있다
    expect(m.estimated[0][2]).toBe(false);
    expect(m.minutes[0][2]).toBeGreaterThan(0);
    expect(m.minutes[1][2]).toBeGreaterThan(0);
  });

  it("도로에서 먼 필지가 없으면 그대로이고 roadEnds는 비어 있다 (두 번 계산하지 않음)", async () => {
    const k = fakeKakao();
    const m = await buildCarMatrixWithRoadEnds([CITY, city2, offsetCoord(CITY, 3000, 0)], "K", { fetchImpl: k.fetch });
    expect(m.roadEnds).toEqual([]);
    expect(m.noRoad).toEqual([]);
    expect(k.calls.multi).toBe(3); // 지점마다 한 번씩만
  });

  it("가까운 도로를 못 찾은 필지는 noRoad로 알리고 그 구간은 추정값이다", async () => {
    const k = fakeKakao();
    const none = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      // 산 필지를 향한 호출은 어디서든 도로 없음
      if (u.includes("/directions") && !u.includes("/destinations")) {
        const d = new URL(u).searchParams.get("destination")!.split(",").map(Number);
        if (distanceMeters({ lng: d[0], lat: d[1] }, MOUNTAIN) < 4000) return json({ routes: [{ result_code: NO_ROAD_CODE }] });
      }
      if (u.includes("/destinations/directions")) {
        const body = JSON.parse(String(init?.body));
        return json({
          routes: body.destinations.map((x: { x: number; y: number; key: string }) =>
            distanceMeters({ lat: x.y, lng: x.x }, MOUNTAIN) < 4000 ? { key: x.key, result_code: NO_ROAD_CODE } : { key: x.key, result_code: 0, summary: { distance: 1000, duration: 120 } },
          ),
        });
      }
      return k.fetch(url, init);
    }) as unknown as typeof fetch;
    const m = await buildCarMatrixWithRoadEnds([CITY, city2, MOUNTAIN], "K", { fetchImpl: none });
    expect(m.roadEnds).toEqual([]);
    expect(m.noRoad).toEqual([2]);
    expect(m.estimated[0][2]).toBe(true);
    expect(m.minutes[0][2]).toBeGreaterThan(0);
  });

  it("출발지에서 10km 넘게 떨어진 도로 없는 필지도, 보완 조회 시간이 모자라 보여도 놓치지 않는다 (출발지 구간을 먼저 조회)", async () => {
    // 산 필지(MOUNTAIN)는 출발지(CITY)에서 약 14km라 다중 목적지에서는 '반경 밖(304)'으로만 나오고,
    // 도로가 없다(103)는 사실은 출발지→필지 단건 조회로만 알 수 있다.
    expect(distanceMeters(CITY, MOUNTAIN)).toBeGreaterThan(10000);
    // 필지 6곳을 출발지 둘레 11km 원 위에 60도 간격으로 놓는다. 출발지와도 서로(이웃끼리)도 11km라 모두 '반경 밖'이다.
    // 산 필지의 출발지 구간(약 13km)은 이들보다 멀다. 그래서 거리순으로만 조회하면 11km 구간 12개가 먼저 차지해
    // 단건 조회를 7건만 허락할 때 산 필지 구간이 빠지고, 출발지 구간을 먼저 조회해야만 놓치지 않는다.
    const crowd = Array.from({ length: 6 }, (_, i) => offsetCoord(CITY, 11000, i * 60));
    const k = fakeKakao();
    const m = await buildCarMatrixWithRoadEnds([CITY, ...crowd, MOUNTAIN], "K", { fetchImpl: k.fetch, maxSingleCalls: 7 });
    const mountainIndex = crowd.length + 1;
    expect(m.roadEnds.map((r) => r.index)).toContain(mountainIndex);
    expect(m.noRoad).toEqual([]);
  });

  it("도로 끝으로 옮긴 뒤에는 옮긴 필지와 관련된 구간만 다시 조회한다 (전체를 다시 계산하지 않음)", async () => {
    const city3 = offsetCoord(CITY, 3000, 0);
    const a = offsetCoord(CITY, 2000, 90);
    const pts = [CITY, a, city3, offsetCoord(CITY, 2500, 180), MOUNTAIN];
    const first = fakeKakao();
    const once = await buildCarMatrixWithRoadEnds(pts.slice(0, 4), "K", { fetchImpl: first.fetch }); // 산 필지가 없으면 한 번만 계산
    expect(first.calls.multi).toBe(4);
    expect(once.roadEnds).toEqual([]);

    const k = fakeKakao();
    const sizes: number[] = [];
    const counting = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/destinations/directions")) sizes.push(JSON.parse(String(init?.body)).destinations.length);
      return k.fetch(url, init);
    }) as unknown as typeof fetch;
    const m = await buildCarMatrixWithRoadEnds(pts, "K", { fetchImpl: counting });
    expect(m.roadEnds).toHaveLength(1);
    // 호출 횟수는 지점마다 한 번씩이라 같지만, 두 번째 계산은 목적지가 옮긴 필지 하나뿐이라 호출에 담기는 목적지가 훨씬 적다.
    // 5개 지점이면 첫 계산에 20곳. 전체를 다시 계산하면 20곳이 더해져 40곳이 되고, 옮긴 필지만 다시 하면 8곳이 더해져 28곳이다.
    const total = sizes.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(40);
    expect(total).toBeLessThanOrEqual(30);
  });

  it("옮긴 뒤에도 옮기지 않은 구간의 값은 첫 시간표와 같다 (다시 계산하지 않고 그대로 쓴다)", async () => {
    const a = offsetCoord(CITY, 2000, 90);
    const b = offsetCoord(CITY, 2500, 180);
    const withoutMountain = await buildCarMatrixWithRoadEnds([CITY, a, b], "K", { fetchImpl: fakeKakao().fetch });
    const withMountain = await buildCarMatrixWithRoadEnds([CITY, a, b, MOUNTAIN], "K", { fetchImpl: fakeKakao().fetch });
    // 산 필지(3번)와 관련 없는 구간(0,1,2번 사이)은 같다
    for (const x of [0, 1, 2]) {
      for (const y of [0, 1, 2]) {
        expect(withMountain.minutes[x][y]).toBe(withoutMountain.minutes[x][y]);
        expect(withMountain.estimated[x][y]).toBe(withoutMountain.estimated[x][y]);
      }
    }
    expect(withMountain.roadEnds).toHaveLength(1);
    expect(withMountain.minutes[0][3]).toBeGreaterThan(0);
    expect(withMountain.estimated[0][3]).toBe(false);
  });

  it("도로 끝도 찾지 못하면, 옮기지 않은 구간은 그대로이고 그 필지 구간만 추정값이다", async () => {
    const k = fakeKakao();
    const none = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/destinations/directions")) {
        const body = JSON.parse(String(init?.body));
        return json({
          routes: body.destinations.map((x: { x: number; y: number; key: string }) =>
            distanceMeters({ lat: x.y, lng: x.x }, MOUNTAIN) < 4000
              ? { key: x.key, result_code: NO_ROAD_CODE }
              : { key: x.key, result_code: 0, summary: { distance: 1000, duration: 120 } },
          ),
        });
      }
      const d = new URL(u).searchParams.get("destination")!.split(",").map(Number);
      if (distanceMeters({ lng: d[0], lat: d[1] }, MOUNTAIN) < 4000) return json({ routes: [{ result_code: NO_ROAD_CODE }] });
      return k.fetch(url, init);
    }) as unknown as typeof fetch;
    const a = offsetCoord(CITY, 2000, 90);
    const m = await buildCarMatrixWithRoadEnds([CITY, a, MOUNTAIN], "K", { fetchImpl: none });
    expect(m.noRoad).toEqual([2]);
    expect(m.estimated[0][1]).toBe(false);
    expect(m.estimated[0][2]).toBe(true);
  });

  it("도로 끝 찾기는 필지 수에 상한이 있다", async () => {
    expect(MAX_ROAD_END_SEARCHES).toBe(6);
    const k = fakeKakao();
    const mountains = Array.from({ length: 8 }, (_, i) => offsetCoord(MOUNTAIN, i * 5, 0)); // 서로 가까운 산 필지 8개
    const m = await buildCarMatrixWithRoadEnds([CITY, ...mountains], "K", { fetchImpl: k.fetch });
    expect(m.roadEnds.length + m.noRoad.length).toBe(8);
    expect(m.roadEnds.length).toBeLessThanOrEqual(MAX_ROAD_END_SEARCHES);
  });
});

describe("fetchCarLegs — 확정된 순서의 구간과 도로 끝 거리", () => {
  it("정상 도로는 도로 끝과의 거리가 거의 0이다", async () => {
    const r = await fetchCarLegs([CITY, city2(), CITY], "K", { fetchImpl: fakeKakao().fetch });
    expect(r).toHaveLength(2);
    r.forEach((x) => expect(x.ok && x.endGapMeters).toBeLessThan(5));
  });

  it("도로 끝에서 멀리 떨어진 필지(도로까지 400m)는 그 거리를 알려 준다", async () => {
    const parcel = offsetCoord(ROAD, 400, 90);
    const r = await fetchCarLegs([CITY, parcel], "K", { fetchImpl: fakeKakao().fetch });
    expect(r[0].ok).toBe(true);
    if (r[0].ok) expect(r[0].endGapMeters).toBeGreaterThan(390);
  });

  it("도로가 없는 구간은 실패와 코드, 시간 예산이 지나면 조회하지 않는다", async () => {
    expect(await fetchCarLegs([CITY, MOUNTAIN], "K", { fetchImpl: fakeKakao().fetch })).toEqual([{ ok: false, status: NO_ROAD_CODE }]);
    const k = fakeKakao();
    let t = 0;
    const r = await fetchCarLegs([CITY, city2()], "K", { fetchImpl: k.fetch, budgetMs: 100, now: () => (t += 1000) });
    expect(k.calls.single).toBe(0);
    expect(r).toEqual([{ ok: false, status: null }]);
  });

  it("설정 문제면 오류, 지점이 모자라면 빈 결과", async () => {
    await expect(fetchCarLegs([CITY, city2()], "K", { fetchImpl: fakeKakao({ auth: true }).fetch })).rejects.toBeInstanceOf(KakaoAuthError);
    expect(await fetchCarLegs([CITY], "K")).toEqual([]);
  });

  function city2() {
    return offsetCoord(CITY, 2000, 90);
  }
});

describe("API 경로 — 도로에서 먼 필지", () => {
  const post = (handler: typeof postMatrix, body: unknown) => handler(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));

  it("POST /api/matrix: 옮겨 계산한 필지(roadEnds)를 응답에 담는다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    vi.stubGlobal("fetch", fakeKakao().fetch);
    const res = await post(postMatrix, { mode: "car", points: [CITY, offsetCoord(CITY, 2000, 90), MOUNTAIN] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roadEnds).toHaveLength(1);
    expect(body.roadEnds[0]).toMatchObject({ index: 2 });
    expect(body.roadEnds[0].meters).toBeGreaterThan(950);
  });

  it("POST /api/route-legs: 자차 구간과 도로 끝 거리(gap)를 돌려준다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    vi.stubGlobal("fetch", fakeKakao().fetch);
    const res = await post(postLegs, { mode: "car", points: [CITY, offsetCoord(ROAD, 400, 90)] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0]).toMatchObject({ ok: true });
    expect(body.legs[0].endGapMeters).toBeGreaterThan(390);
  });

  it("POST /api/route-legs: 설정 문제면 502 (키 값은 노출하지 않음)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "TOPSECRETKEY");
    vi.stubGlobal("fetch", fakeKakao({ auth: true }).fetch);
    const res = await post(postLegs, { mode: "car", points: [CITY, offsetCoord(CITY, 2000, 90)] });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("TOPSECRETKEY");
  });
});
