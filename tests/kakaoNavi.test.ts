import { afterEach, describe, expect, it, vi } from "vitest";
import { straightDistanceKm } from "@/lib/core/distance";
import { KakaoAuthError } from "@/lib/server/kakao";
import {
  buildCarMatrix,
  DEFAULT_SINGLE_BUDGET_MS,
  fetchMulti,
  fetchSingle,
  MAX_DESTINATIONS,
  MULTI_RADIUS_M,
  NAVI_CONCURRENCY,
  OUT_OF_RADIUS_CODE,
} from "@/lib/server/kakaoNavi";
import { POST } from "@/app/api/matrix/route";
import type { Coord } from "@/lib/core/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** 실제 호출로 확인한 카카오 동작을 흉내 낸 가짜 서버: 목적지 30개 제한, 반경 10km 밖은 304, 시간은 직선거리 기준 */
function fakeKakao(opts: { failMulti?: number; failSingle?: boolean; auth?: boolean } = {}) {
  const calls = { multi: 0, single: 0 };
  const secondsFor = (a: Coord, b: Coord) => Math.round(straightDistanceKm(a, b) * 1.4 * 120); // 약 30km/h
  const metersFor = (a: Coord, b: Coord) => Math.round(straightDistanceKm(a, b) * 1.4 * 1000);

  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (opts.auth) return json({ errorType: "NotAuthorizedError" }, 403);

    if (u.includes("/destinations/directions")) {
      calls.multi++;
      if (opts.failMulti && calls.multi <= opts.failMulti) return json({}, 500);
      const body = JSON.parse(String(init?.body));
      if (body.destinations.length > 30) return json({ code: -2 }, 400);
      if (body.radius > 10000) return json({}, 400);
      const o = { lat: body.origin.y, lng: body.origin.x };
      return json({
        routes: body.destinations.map((d: { x: number; y: number; key: string }) => {
          const c = { lat: d.y, lng: d.x };
          if (straightDistanceKm(o, c) * 1000 > body.radius) return { key: d.key, result_code: 304 };
          return { key: d.key, result_code: 0, summary: { distance: metersFor(o, c), duration: secondsFor(o, c) } };
        }),
      });
    }

    calls.single++;
    if (opts.failSingle) return json({}, 500);
    const q = new URL(u).searchParams;
    const [ox, oy] = q.get("origin")!.split(",").map(Number);
    const [dx, dy] = q.get("destination")!.split(",").map(Number);
    const [o, c] = [{ lat: oy, lng: ox }, { lat: dy, lng: dx }];
    return json({ routes: [{ result_code: 0, summary: { distance: metersFor(o, c), duration: secondsFor(o, c) } }] });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const SEOUL: Coord = { lat: 37.5666, lng: 126.9784 };
const near = (dLat: number, dLng = 0): Coord => ({ lat: SEOUL.lat + dLat, lng: SEOUL.lng + dLng });
const BUSAN: Coord = { lat: 35.1563, lng: 129.1426 };
/** 서울에서 멀리(반경 10km 밖) 떨어진 여러 지점 */
const offsetFar = (i: number): Coord => ({ lat: 36.5 + i * 0.3, lng: 127.5 + i * 0.2 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchMulti / fetchSingle — 카카오 호출 한 번", () => {
  it("다중 목적지: 성공은 분·km로, 반경 밖은 코드 304로 돌려준다", async () => {
    const k = fakeKakao();
    const r = await fetchMulti(SEOUL, [{ key: "a", coord: near(0.05) }, { key: "b", coord: BUSAN }], "KEY", k.fetch);
    expect(r.get("a")).toMatchObject({ ok: true });
    const a = r.get("a");
    expect(a && a.ok && a.minutes).toBeGreaterThan(0);
    expect(r.get("b")).toEqual({ ok: false, code: OUT_OF_RADIUS_CODE });
  });

  it("요청에 최대 반경(10km)과 키를 헤더로 보내고, 좌표 외의 값은 보내지 않는다", async () => {
    const k = fakeKakao();
    await fetchMulti(SEOUL, [{ key: "a", coord: near(0.01) }], "SECRETKEY", k.fetch);
    const [url, init] = (k.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain("SECRETKEY");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "KakaoAK SECRETKEY" });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.radius).toBe(MULTI_RADIUS_M);
    expect(Object.keys(body).sort()).toEqual(["destinations", "origin", "priority", "radius"]);
  });

  it("401·403은 설정 문제라 오류를 던진다", async () => {
    await expect(fetchMulti(SEOUL, [{ key: "a", coord: near(0.01) }], "K", fakeKakao({ auth: true }).fetch)).rejects.toBeInstanceOf(KakaoAuthError);
    await expect(fetchSingle(SEOUL, near(0.01), "K", fakeKakao({ auth: true }).fetch)).rejects.toBeInstanceOf(KakaoAuthError);
  });

  it("서버 오류·네트워크 실패는 코드 없는 실패로 돌려준다", async () => {
    const down = vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch;
    expect((await fetchMulti(SEOUL, [{ key: "a", coord: near(0.01) }], "K", down)).get("a")).toEqual({ ok: false, code: null });
    expect(await fetchSingle(SEOUL, near(0.01), "K", down)).toEqual({ ok: false, code: null });
  });

  it("도로를 못 찾은 결과 코드(예: 103)는 코드를 그대로 돌려준다", async () => {
    const f = vi.fn().mockResolvedValue(json({ routes: [{ key: "a", result_code: 103 }] })) as unknown as typeof fetch;
    expect((await fetchMulti(SEOUL, [{ key: "a", coord: near(0.01) }], "K", f)).get("a")).toEqual({ ok: false, code: 103 });
  });
});

describe("buildCarMatrix — 구간 시간표", () => {
  it("가까운 지점들은 지점마다 한 번씩만 호출하고 모두 길찾기 결과다", async () => {
    const k = fakeKakao();
    const pts = [SEOUL, near(0.01), near(0.02), near(0.03, 0.01)];
    const m = await buildCarMatrix(pts, "K", { fetchImpl: k.fetch });
    expect(k.calls).toEqual({ multi: 4, single: 0 });
    expect(m.stats).toEqual({ multiCalls: 4, singleCalls: 0, estimatedPairs: 0 });
    expect(m.estimated.flat().some(Boolean)).toBe(false);
    for (let a = 0; a < 4; a++) {
      expect(m.minutes[a][a]).toBe(0);
      for (let b = 0; b < 4; b++) if (a !== b) expect(m.minutes[a][b]).toBeGreaterThan(0);
    }
    expect(m.codes[0][1]).toBe(0);
  });

  it("31개 지점(출발지+필지 30개)도 지점당 한 번, 총 31번 호출한다", async () => {
    const k = fakeKakao();
    const pts = Array.from({ length: 31 }, (_, i) => near(i * 0.002, (i % 5) * 0.002));
    const m = await buildCarMatrix(pts, "K", { fetchImpl: k.fetch });
    expect(k.calls.multi).toBe(31);
    expect(m.minutes).toHaveLength(31);
  });

  it("반경 10km 밖 구간은 단건으로 보완하고, 오가는 값이 같게 채운다", async () => {
    const k = fakeKakao();
    const m = await buildCarMatrix([SEOUL, near(0.01), BUSAN], "K", { fetchImpl: k.fetch });
    // 서울↔부산, 근처↔부산: 두 쌍을 단건으로 (a<b 한 번씩)
    expect(k.calls.single).toBe(2);
    expect(m.minutes[0][2]).toBeGreaterThan(100);
    expect(m.minutes[2][0]).toBe(m.minutes[0][2]);
    expect(m.estimated[0][2]).toBe(false);
    expect(m.codes[0][2]).toBe(0);
  });

  it("단건 호출 수에 상한이 있고, 넘는 구간은 추정값으로 채운다", async () => {
    const k = fakeKakao();
    const m = await buildCarMatrix([SEOUL, near(0.01), BUSAN], "K", { fetchImpl: k.fetch, maxSingleCalls: 1 });
    expect(k.calls.single).toBe(1);
    expect(m.stats.estimatedPairs).toBe(2); // 한 쌍(양방향)이 추정값
    const estimatedPairs = [m.estimated[0][2], m.estimated[2][0], m.estimated[1][2], m.estimated[2][1]].filter(Boolean);
    expect(estimatedPairs).toHaveLength(2);
  });

  it("시간 예산이 지나면 단건 호출을 하지 않고 추정값으로 채운다", async () => {
    const k = fakeKakao();
    let t = 0;
    const m = await buildCarMatrix([SEOUL, BUSAN], "K", { fetchImpl: k.fetch, budgetMs: 100, now: () => (t += 1000) });
    expect(k.calls.single).toBe(0);
    expect(m.estimated[0][1]).toBe(true);
    expect(m.minutes[0][1]).toBeGreaterThan(100); // 추정값도 서울↔부산이라 긴 시간
  });

  it("반경 밖 보완 조회는 전체 예산과 별개로 짧은 시간(기본 1.5초)만 쓴다", async () => {
    expect(DEFAULT_SINGLE_BUDGET_MS).toBe(1500);
    // 전체 예산은 넉넉하지만 보완 조회 예산이 0이면 단건 조회를 하지 않고 추정값으로 둔다
    const k = fakeKakao();
    const m = await buildCarMatrix([SEOUL, near(0.01), BUSAN], "K", { fetchImpl: k.fetch, budgetMs: 100000, singleBudgetMs: 0 });
    expect(k.calls.single).toBe(0);
    expect(m.estimated[0][2]).toBe(true);
    expect(m.stats.estimatedPairs).toBe(4);
    // 보완 조회 예산이 충분하면 전과 같이 조회한다
    const k2 = fakeKakao();
    await buildCarMatrix([SEOUL, near(0.01), BUSAN], "K", { fetchImpl: k2.fetch, budgetMs: 100000, singleBudgetMs: 100000 });
    expect(k2.calls.single).toBe(2);
  });

  it("보완 조회 시간이 지나면 남은 구간은 조회하지 않는다 (시계를 직접 돌려서 확인)", async () => {
    const k = fakeKakao();
    let clock = 0;
    const pts = [SEOUL, BUSAN, offsetFar(1), offsetFar(2), offsetFar(3)];
    const m = await buildCarMatrix(pts, "K", {
      fetchImpl: k.fetch,
      budgetMs: 1_000_000,
      singleBudgetMs: 1500,
      // 호출 판단 때마다 시계가 1초씩 간다: 1500ms 예산이면 처음 1~2건만 조회하고 멈춘다
      now: () => (clock += 1000),
    });
    expect(k.calls.single).toBeGreaterThan(0);
    expect(k.calls.single).toBeLessThan(6);
    expect(m.stats.estimatedPairs).toBeGreaterThan(0);
  });

  it("길찾기 호출이 실패한 구간은 직선거리 추정값으로 채운다 (오류로 멈추지 않음)", async () => {
    const k = fakeKakao({ failMulti: 99 });
    const m = await buildCarMatrix([SEOUL, near(0.01), near(0.02)], "K", { fetchImpl: k.fetch });
    expect(m.estimated[0][1] && m.estimated[1][2] && m.estimated[2][0]).toBe(true);
    expect(m.stats.estimatedPairs).toBe(6);
    expect(m.minutes[0][1]).toBeGreaterThan(0);
  });

  it("일부 호출만 실패하면 실패한 지점의 구간만 추정값이다", async () => {
    const k = fakeKakao({ failMulti: 1 });
    const m = await buildCarMatrix([SEOUL, near(0.01), near(0.02)], "K", { fetchImpl: k.fetch });
    const total = m.estimated.flat().filter(Boolean).length;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(6);
  });

  it("같은 위치의 지점끼리는 호출 없이 0분·0km이고 추정값이 아니다", async () => {
    const k = fakeKakao();
    const m = await buildCarMatrix([SEOUL, SEOUL, near(0.02)], "K", { fetchImpl: k.fetch });
    expect(m.minutes[0][1]).toBe(0);
    expect(m.km[1][0]).toBe(0);
    expect(m.estimated[0][1]).toBe(false);
  });

  it("카카오가 설정 문제로 거부하면 오류를 던진다 (모든 구간을 추정값으로 덮지 않음)", async () => {
    await expect(buildCarMatrix([SEOUL, near(0.01)], "K", { fetchImpl: fakeKakao({ auth: true }).fetch })).rejects.toBeInstanceOf(KakaoAuthError);
  });

  it("동시에 보내는 요청 수가 제한(NAVI_CONCURRENCY)을 넘지 않는다", async () => {
    let running = 0;
    let maxRunning = 0;
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      const body = JSON.parse(String(init?.body));
      return json({ routes: body.destinations.map((d: { key: string }) => ({ key: d.key, result_code: 0, summary: { distance: 1000, duration: 120 } })) });
    });
    const pts = Array.from({ length: 31 }, (_, i) => near(i * 0.002, (i % 5) * 0.002));
    await buildCarMatrix(pts, "K", { fetchImpl: f as unknown as typeof fetch });
    expect(NAVI_CONCURRENCY).toBe(8);
    expect(maxRunning).toBeLessThanOrEqual(NAVI_CONCURRENCY);
    expect(maxRunning).toBeGreaterThan(1); // 실제로 동시에 보낸다
  });

  it("목적지가 30개를 넘지 않도록 나눠 보낸다", async () => {
    const k = fakeKakao();
    const pts = Array.from({ length: 33 }, (_, i) => near(i * 0.001));
    await buildCarMatrix(pts, "K", { fetchImpl: k.fetch });
    const sizes = (k.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([u]) => String(u).includes("/destinations/"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).destinations.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_DESTINATIONS);
  });
});

describe("POST /api/matrix", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/matrix", { method: "POST", body: JSON.stringify(body) }));
  const pts = [SEOUL, near(0.01)];

  it("키가 없으면 500", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    expect((await post({ points: pts, mode: "car" })).status).toBe(500);
  });

  it("자차가 아니면 400", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    const res = await post({ points: pts, mode: "transit" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_MODE");
  });

  it("잘못된 지점은 400 (개수, 숫자 아님, 대한민국 밖)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    const bad = [
      {},
      { mode: "car" },
      { mode: "car", points: [SEOUL] },
      { mode: "car", points: Array(32).fill(SEOUL) },
      { mode: "car", points: [SEOUL, { lat: "x", lng: 1 }] },
      { mode: "car", points: [SEOUL, { lat: 35.68, lng: 139.69 }] },
    ];
    for (const body of bad) expect((await post(body)).status).toBe(400);
  });

  it("정상이면 시간표를 돌려준다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    vi.stubGlobal("fetch", fakeKakao().fetch);
    const res = await post({ points: pts, mode: "car" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.minutes).toHaveLength(2);
    expect(body.minutes[0][1]).toBeGreaterThan(0);
    expect(body.estimated[0][1]).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["codes", "estimated", "km", "minutes", "noRoad", "roadEnds", "stats"]);
    expect(body.roadEnds).toEqual([]);
    expect(body.noRoad).toEqual([]);
  });

  it("카카오가 설정 문제로 거부하면 502와 안내 문구 (키 값은 노출하지 않음)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "TOPSECRETKEY");
    vi.stubGlobal("fetch", fakeKakao({ auth: true }).fetch);
    const res = await post({ points: pts, mode: "car" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("ROUTE_SERVICE_REJECTED");
    expect(text).not.toContain("TOPSECRETKEY");
  });
});
