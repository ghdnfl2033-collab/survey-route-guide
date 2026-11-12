import { afterEach, describe, expect, it, vi } from "vitest";
import { KakaoAuthError } from "@/lib/server/kakao";
import { fetchTransitLeg, fetchTransitLegs, MAX_TRANSIT_LEGS, pickFastestRoute, TRANSIT_CONCURRENCY } from "@/lib/server/kakaoTransit";
import { POST } from "@/app/api/route-legs/route";
import type { Coord } from "@/lib/core/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const route = (seconds: number, meters: number, transfers: number) => ({ properties: { totalTime: seconds, totalDistance: meters, transfers } });
const transitOk = (...routes: ReturnType<typeof route>[]) => json({ status: "OK", properties: { total: routes.length }, routes });
const walkOk = (meters: number, seconds: number) => json({ status: "OK", route: { properties: { totalDistance: meters, totalTime: seconds } } });
const A: Coord = { lat: 37.4979, lng: 127.0276 };
const B: Coord = { lat: 37.5666, lng: 126.9784 };
const C: Coord = { lat: 37.51, lng: 127.04 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pickFastestRoute — 후보 경로 중 고르기", () => {
  it("첫 번째가 아니라 총 소요 시간이 가장 짧은 경로를 고른다 (실제 응답 모양: 2887초·3042초·2247초)", () => {
    const r = pickFastestRoute([route(2887, 21560, 0), route(3042, 11889, 0), route(2247, 9531, 1), route(2222, 9864, 1)]);
    expect(r).toEqual({ minutes: 37.03, km: 9.86, transfers: 1 });
  });

  it("시간이 같으면 환승이 적은 쪽", () => {
    expect(pickFastestRoute([route(600, 1000, 2), route(600, 1200, 0)])?.transfers).toBe(0);
  });

  it("환승 정보가 없으면 0으로 본다", () => {
    expect(pickFastestRoute([{ properties: { totalTime: 600, totalDistance: 1000 } }])?.transfers).toBe(0);
  });

  it("쓸 수 있는 경로가 없으면 null", () => {
    expect(pickFastestRoute([])).toBeNull();
    expect(pickFastestRoute([{ properties: { totalTime: NaN, totalDistance: 1 } }, {}])).toBeNull();
  });
});

describe("fetchTransitLeg — 한 구간", () => {
  it("가장 빠른 경로의 시간·거리·환승 횟수를 돌려준다", async () => {
    const f = vi.fn().mockResolvedValue(transitOk(route(2887, 21560, 0), route(2247, 9531, 1))) as unknown as typeof fetch;
    expect(await fetchTransitLeg(A, B, "K", f)).toEqual({ ok: true, minutes: 37.45, km: 9.53, transfers: 1, walk: false });
  });

  it("좌표를 start/end로, 키는 헤더로만 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(transitOk(route(600, 1000, 0)));
    await fetchTransitLeg(A, B, "SECRETKEY", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0];
    const q = new URL(String(url)).searchParams;
    expect([q.get("start_x"), q.get("start_y"), q.get("end_x"), q.get("end_y")]).toEqual([String(A.lng), String(A.lat), String(B.lng), String(B.lat)]);
    expect(String(url)).not.toContain("SECRETKEY");
    expect((init as RequestInit).headers).toEqual({ Authorization: "KakaoAK SECRETKEY" });
  });

  it("같은 지점(EQUAL_POINTS)은 0분 성공", async () => {
    const f = vi.fn().mockResolvedValue(json({ status: "EQUAL_POINTS" })) as unknown as typeof fetch;
    expect(await fetchTransitLeg(A, A, "K", f)).toEqual({ ok: true, minutes: 0, km: 0, transfers: 0, walk: false });
  });

  it("경로가 없으면 상태값과 함께 실패로 돌려준다 (이 함수는 도보로 대신하지 않음)", async () => {
    for (const status of ["NO_RESULTS", "ENDNODES_NULL", "STARTNODES_NULL", "INVALID_REQUEST"]) {
      const f = vi.fn().mockResolvedValue(json({ status })) as unknown as typeof fetch;
      expect(await fetchTransitLeg(A, B, "K", f)).toEqual({ ok: false, status });
    }
  });

  it("401·403은 설정 문제라 오류를 던진다", async () => {
    for (const status of [401, 403]) {
      await expect(fetchTransitLeg(A, B, "K", vi.fn().mockResolvedValue(json({}, status)) as unknown as typeof fetch)).rejects.toBeInstanceOf(KakaoAuthError);
    }
  });

  it("서버 오류·네트워크 실패·이상한 응답은 상태 없는 실패", async () => {
    expect(await fetchTransitLeg(A, B, "K", vi.fn().mockResolvedValue(json({}, 500)) as unknown as typeof fetch)).toEqual({ ok: false, status: null });
    expect(await fetchTransitLeg(A, B, "K", vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch)).toEqual({ ok: false, status: null });
    expect(await fetchTransitLeg(A, B, "K", vi.fn().mockResolvedValue(new Response("x")) as unknown as typeof fetch)).toEqual({ ok: false, status: null });
    expect((await fetchTransitLeg(A, B, "K", vi.fn().mockResolvedValue(json({ status: "OK", routes: [] })) as unknown as typeof fetch)).ok).toBe(false);
  });
});

describe("fetchTransitLegs — 지점을 이은 구간들 (경로 없으면 도보로 대신)", () => {
  /** 대중교통 주소와 도보 주소를 구별해 응답하는 가짜 서버 */
  const fake = (transit: () => Response, walk: () => Response) =>
    vi.fn(async (url: RequestInfo | URL) => (String(url).includes("/routing/walk") ? walk() : transit())) as unknown as typeof fetch;

  it("지점 N개면 구간 N-1개를 순서대로 돌려준다", async () => {
    const f = fake(() => transitOk(route(600, 1000, 1)), () => walkOk(1, 1));
    const r = await fetchTransitLegs([A, B, C], "K", { fetchImpl: f });
    expect(r).toEqual([
      { ok: true, minutes: 10, km: 1, transfers: 1, walk: false },
      { ok: true, minutes: 10, km: 1, transfers: 1, walk: false },
    ]);
  });

  it("대중교통 경로가 없으면 걷는 시간으로 대신하고 도보 구간(walk: true)으로 표시한다", async () => {
    const f = fake(() => json({ status: "NO_RESULTS" }), () => walkOk(300, 280));
    expect(await fetchTransitLegs([A, C], "K", { fetchImpl: f })).toEqual([{ ok: true, minutes: 4.67, km: 0.3, transfers: 0, walk: true }]);
  });

  it("경로도 없고 걷는 길도 못 구하면 실패로 남긴다 (예: 서울→부산)", async () => {
    const f = fake(() => json({ status: "NO_RESULTS" }), () => json({ status: "TOO_FAR_AWAY" }));
    expect(await fetchTransitLegs([A, B], "K", { fetchImpl: f })).toEqual([{ ok: false, status: "NO_RESULTS" }]);
  });

  it("호출 자체가 실패한 구간은 도보로 대신하지 않는다 (경로가 없는 게 아님)", async () => {
    const walk = vi.fn(() => walkOk(1, 1));
    const f = fake(() => json({}, 500), walk);
    expect(await fetchTransitLegs([A, B], "K", { fetchImpl: f })).toEqual([{ ok: false, status: null }]);
    expect(walk).not.toHaveBeenCalled();
  });

  it("경로가 있는 구간은 도보를 호출하지 않는다", async () => {
    const walk = vi.fn(() => walkOk(1, 1));
    await fetchTransitLegs([A, B], "K", { fetchImpl: fake(() => transitOk(route(600, 1000, 0)), walk) });
    expect(walk).not.toHaveBeenCalled();
  });

  it("동시에 보내는 요청 수가 제한을 넘지 않는다", async () => {
    let running = 0;
    let maxRunning = 0;
    const f = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return transitOk(route(600, 1000, 0));
    });
    const pts = Array.from({ length: 32 }, (_, i) => ({ lat: 37.5 + i * 0.001, lng: 127 }));
    const r = await fetchTransitLegs(pts, "K", { fetchImpl: f as unknown as typeof fetch });
    expect(r).toHaveLength(MAX_TRANSIT_LEGS);
    expect(maxRunning).toBeLessThanOrEqual(TRANSIT_CONCURRENCY);
  });

  it("시간 예산이 지나면 남은 구간은 조회하지 않고 실패(상태 없음)로 남긴다", async () => {
    const f = vi.fn().mockResolvedValue(transitOk(route(600, 1000, 0)));
    let t = 0;
    const r = await fetchTransitLegs([A, B, C], "K", { fetchImpl: f as unknown as typeof fetch, budgetMs: 100, now: () => (t += 1000) });
    expect(f).not.toHaveBeenCalled();
    expect(r).toEqual([{ ok: false, status: null }, { ok: false, status: null }]);
  });

  it("설정 문제면 오류를 던진다", async () => {
    await expect(fetchTransitLegs([A, B], "K", { fetchImpl: vi.fn().mockResolvedValue(json({}, 403)) as unknown as typeof fetch })).rejects.toBeInstanceOf(KakaoAuthError);
  });

  it("지점이 없거나 하나면 빈 결과", async () => {
    expect(await fetchTransitLegs([], "K")).toEqual([]);
    expect(await fetchTransitLegs([A], "K")).toEqual([]);
  });
});

describe("POST /api/route-legs — 대중교통", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/route-legs", { method: "POST", body: JSON.stringify(body) }));

  it("transit이면 환승 횟수와 도보 구간 표시가 포함된 결과를 돌려준다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    vi.stubGlobal("fetch", vi.fn(async () => transitOk(route(1200, 5000, 2))));
    const res = await post({ points: [A, B], mode: "transit" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ legs: [{ ok: true, minutes: 20, km: 5, transfers: 2, walk: false }] });
  });

  it("알 수 없는 수단은 400", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    const res = await post({ points: [A, B], mode: "bike" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_MODE");
  });

  it("카카오가 설정 문제로 거부하면 502와 안내 문구 (키 값은 노출하지 않음)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "TOPSECRETKEY");
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 403)));
    const res = await post({ points: [A, B], mode: "transit" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("ROUTE_SERVICE_REJECTED");
    expect(text).not.toContain("TOPSECRETKEY");
  });
});

describe("이용 노선 이름", () => {
  const step = (type: string, ...names: string[]) => ({ properties: { type, vehicles: names.map((name) => ({ name })) } });
  const withSteps = (steps: unknown[]) => ({ properties: { totalTime: 600, totalDistance: 1000, transfers: 1 }, steps });

  it("지하철은 호선, 버스는 번호를 타는 순서대로 뽑고 걷기는 건너뛴다", () => {
    const r = pickFastestRoute([withSteps([step("BUS", "402"), step("WALKING"), step("SUBWAY", "3호선", "3호선"), step("SUBWAY", "신분당선")]) as never]);
    expect(r?.lines).toEqual(["버스 402", "3호선", "신분당선"]);
  });

  it("같은 정류장에서 탈 수 있는 버스가 여럿이면 '외 N대'를 붙인다", () => {
    const r = pickFastestRoute([withSteps([step("BUS", "470", "741")]) as never]);
    expect(r?.lines).toEqual(["버스 470 외 1대"]);
  });

  it("노선 정보가 없으면 lines를 넣지 않는다", () => {
    expect(pickFastestRoute([route(600, 1000, 1)])).not.toHaveProperty("lines");
  });

  it("가장 빠른 경로의 노선을 돌려준다", () => {
    const slow = { ...withSteps([step("BUS", "1")]), properties: { totalTime: 900, totalDistance: 1000, transfers: 0 } };
    const fast = withSteps([step("SUBWAY", "2호선")]);
    expect(pickFastestRoute([slow as never, fast as never])?.lines).toEqual(["2호선"]);
  });
});

describe("승차·하차 정류장", () => {
  const stopStep = (type: string, name: string, stops: string[]) => ({
    properties: { type, vehicles: [{ name }], stops: stops.map((n) => ({ name: n })) },
  });
  const r1 = (steps: unknown[]) => ({ properties: { totalTime: 600, totalDistance: 1000, transfers: 0 }, steps });

  it("승차·하차 정류장과 정차 수를 노선마다 뽑는다", () => {
    const r = pickFastestRoute([r1([stopStep("SUBWAY", "2호선", ["을지로입구", "을지로3가", "강남"]), stopStep("BUS", "402", ["가", "나"])]) as never]);
    expect(r?.rides).toEqual([
      { name: "2호선", from: "을지로입구", to: "강남", stops: 2 },
      { name: "버스 402", from: "가", to: "나", stops: 1 },
    ]);
  });

  it("정류장 정보가 없으면 이름만 담는다", () => {
    const r = pickFastestRoute([r1([{ properties: { type: "SUBWAY", vehicles: [{ name: "1호선" }] } }]) as never]);
    expect(r?.rides).toEqual([{ name: "1호선" }]);
  });
});
