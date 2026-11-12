import { afterEach, describe, expect, it, vi } from "vitest";
import { KakaoAuthError } from "@/lib/server/kakao";
import { fetchWalkLeg, fetchWalkLegs, MAX_WALK_LEGS, WALK_CONCURRENCY } from "@/lib/server/kakaoWalk";
import { POST } from "@/app/api/route-legs/route";
import type { Coord } from "@/lib/core/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const walkOk = (meters: number, seconds: number) => json({ status: "OK", route: { properties: { totalDistance: meters, totalTime: seconds } } });
const A: Coord = { lat: 37.4979, lng: 127.0276 };
const B: Coord = { lat: 37.5062, lng: 127.0345 };
const C: Coord = { lat: 37.51, lng: 127.04 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchWalkLeg — 한 구간", () => {
  it("성공하면 미터·초를 km·분으로 바꾼다 (실제 응답: 1555m, 1506초)", async () => {
    const f = vi.fn().mockResolvedValue(walkOk(1555, 1506)) as unknown as typeof fetch;
    expect(await fetchWalkLeg(A, B, "K", f)).toEqual({ ok: true, minutes: 25.1, km: 1.56 });
  });

  it("좌표를 start/end로, 키는 헤더로만 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(walkOk(100, 100));
    await fetchWalkLeg(A, B, "SECRETKEY", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0];
    const q = new URL(String(url)).searchParams;
    expect([q.get("start_x"), q.get("start_y"), q.get("end_x"), q.get("end_y")]).toEqual([String(A.lng), String(A.lat), String(B.lng), String(B.lat)]);
    expect(String(url)).not.toContain("SECRETKEY");
    expect((init as RequestInit).headers).toEqual({ Authorization: "KakaoAK SECRETKEY" });
  });

  it("같은 지점(SAME_POINT)은 0분·0km 성공이다", async () => {
    const f = vi.fn().mockResolvedValue(json({ status: "SAME_POINT", route: { properties: { totalDistance: 0, totalTime: 0 } } })) as unknown as typeof fetch;
    expect(await fetchWalkLeg(A, A, "K", f)).toEqual({ ok: true, minutes: 0, km: 0 });
  });

  it("너무 먼 구간(TOO_FAR_AWAY) 등은 상태값과 함께 실패로 돌려준다", async () => {
    for (const status of ["TOO_FAR_AWAY", "START_LINK_NOT_FOUND", "ROUTE_RESULT_NOT_FOUND"]) {
      const f = vi.fn().mockResolvedValue(json({ status, route: { properties: { totalDistance: 0, totalTime: 0 } } })) as unknown as typeof fetch;
      expect(await fetchWalkLeg(A, B, "K", f)).toEqual({ ok: false, status });
    }
  });

  it("401·403은 설정 문제라 오류를 던진다", async () => {
    for (const status of [401, 403]) {
      await expect(fetchWalkLeg(A, B, "K", vi.fn().mockResolvedValue(json({}, status)) as unknown as typeof fetch)).rejects.toBeInstanceOf(KakaoAuthError);
    }
  });

  it("서버 오류·네트워크 실패·이상한 응답은 상태 없는 실패", async () => {
    expect(await fetchWalkLeg(A, B, "K", vi.fn().mockResolvedValue(json({}, 500)) as unknown as typeof fetch)).toEqual({ ok: false, status: null });
    expect(await fetchWalkLeg(A, B, "K", vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch)).toEqual({ ok: false, status: null });
    expect(await fetchWalkLeg(A, B, "K", vi.fn().mockResolvedValue(new Response("not json")) as unknown as typeof fetch)).toEqual({ ok: false, status: null });
  });
});

describe("fetchWalkLegs — 지점을 이은 구간들", () => {
  it("지점 N개면 구간 N-1개를 순서대로 돌려준다", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const sx = Number(new URL(String(url)).searchParams.get("start_x"));
      return walkOk(Math.round(sx * 10), 600); // 출발 좌표로 구간을 구별할 수 있는 값
    });
    const r = await fetchWalkLegs([A, B, C], "K", { fetchImpl: f as unknown as typeof fetch });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ok: true, km: Math.round(A.lng * 10) / 1000 });
    expect(r[1]).toMatchObject({ ok: true, km: Math.round(B.lng * 10) / 1000 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("동시에 보내는 요청 수가 제한을 넘지 않는다", async () => {
    let running = 0;
    let maxRunning = 0;
    const f = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return walkOk(100, 100);
    });
    const pts = Array.from({ length: 32 }, (_, i) => ({ lat: 37.5 + i * 0.001, lng: 127 }));
    const r = await fetchWalkLegs(pts, "K", { fetchImpl: f as unknown as typeof fetch });
    expect(r).toHaveLength(MAX_WALK_LEGS);
    expect(maxRunning).toBeLessThanOrEqual(WALK_CONCURRENCY);
  });

  it("시간 예산이 지나면 남은 구간은 조회하지 않고 실패(상태 없음)로 남긴다", async () => {
    const f = vi.fn().mockResolvedValue(walkOk(100, 100));
    let t = 0;
    const r = await fetchWalkLegs([A, B, C], "K", { fetchImpl: f as unknown as typeof fetch, budgetMs: 100, now: () => (t += 1000) });
    expect(f).not.toHaveBeenCalled();
    expect(r).toEqual([{ ok: false, status: null }, { ok: false, status: null }]);
  });

  it("일부 구간만 실패해도 나머지는 그대로 돌려준다", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 2 ? json({ status: "TOO_FAR_AWAY" }) : walkOk(500, 480)));
    const r = await fetchWalkLegs([A, B, C, A], "K", { fetchImpl: f as unknown as typeof fetch });
    expect(r.filter((x) => x.ok)).toHaveLength(2);
    expect(r.filter((x) => !x.ok)).toHaveLength(1);
  });

  it("설정 문제면 오류를 던진다", async () => {
    await expect(fetchWalkLegs([A, B], "K", { fetchImpl: vi.fn().mockResolvedValue(json({}, 403)) as unknown as typeof fetch })).rejects.toBeInstanceOf(KakaoAuthError);
  });

  it("지점이 없거나 하나면 빈 결과", async () => {
    expect(await fetchWalkLegs([], "K")).toEqual([]);
    expect(await fetchWalkLegs([A], "K")).toEqual([]);
  });
});

describe("POST /api/route-legs", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/route-legs", { method: "POST", body: JSON.stringify(body) }));

  it("키가 없으면 500", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    expect((await post({ points: [A, B], mode: "walk" })).status).toBe(500);
  });

  it("알 수 없는 수단은 400", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    const res = await post({ points: [A, B], mode: "bike" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_MODE");
  });

  it("잘못된 지점은 400 (개수·숫자 아님·대한민국 밖)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    const bad = [
      { mode: "walk" },
      { mode: "walk", points: [A] },
      { mode: "walk", points: Array(33).fill(A) },
      { mode: "walk", points: [A, { lat: "x", lng: 1 }] },
      { mode: "walk", points: [A, { lat: 35.68, lng: 139.69 }] },
    ];
    for (const body of bad) expect((await post(body)).status).toBe(400);
  });

  it("정상이면 구간별 결과를 돌려준다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    vi.stubGlobal("fetch", vi.fn(async () => walkOk(1000, 900))); // 호출마다 새 응답 (응답 본문은 한 번만 읽을 수 있음)
    const res = await post({ points: [A, B, C], mode: "walk" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ legs: [{ ok: true, minutes: 15, km: 1 }, { ok: true, minutes: 15, km: 1 }] });
  });

  it("카카오가 설정 문제로 거부하면 502와 안내 문구 (키 값은 노출하지 않음)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "TOPSECRETKEY");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 403)));
    const res = await post({ points: [A, B], mode: "walk" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("ROUTE_SERVICE_REJECTED");
    expect(text).not.toContain("TOPSECRETKEY");
  });
});
