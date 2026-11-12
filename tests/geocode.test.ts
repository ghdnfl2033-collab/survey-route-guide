import { afterEach, describe, expect, it, vi } from "vitest";
import { KakaoAuthError, geocodeAddress, geocodeMany } from "@/lib/server/kakao";
import { POST } from "@/app/api/geocode/route";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const found = (x: string, y: string) => json({ documents: [{ x, y }] });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("geocodeAddress — 주소 한 건", () => {
  it("찾으면 위도·경도 숫자로 돌려준다 (x=경도, y=위도)", async () => {
    const f = vi.fn().mockResolvedValue(found("126.9784", "37.5665"));
    const r = await geocodeAddress("서울 중구 태평로1가 31", "KEY", f);
    expect(r).toEqual({ address: "서울 중구 태평로1가 31", status: "found", coord: { lat: 37.5665, lng: 126.9784 } });
  });

  it("키를 헤더로 보내고, 주소만 쿼리로 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(found("1", "2"));
    await geocodeAddress("서울 1-1", "SECRET", f);
    const [url, init] = f.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("query")).toBe("서울 1-1");
    expect(String(url)).not.toContain("SECRET");
    expect((init as RequestInit).headers).toEqual({ Authorization: "KakaoAK SECRET" });
  });

  it("결과가 없으면 짐작하지 않고 notFound", async () => {
    const f = vi.fn().mockResolvedValue(json({ documents: [] }));
    expect(await geocodeAddress("없는 주소", "K", f)).toEqual({ address: "없는 주소", status: "notFound" });
  });

  it("좌표가 숫자가 아니면 notFound", async () => {
    const f = vi.fn().mockResolvedValue(found("abc", "def"));
    expect((await geocodeAddress("A", "K", f)).status).toBe("notFound");
  });

  it("401·403은 설정 문제라 오류를 던진다", async () => {
    for (const status of [401, 403]) {
      const f = vi.fn().mockResolvedValue(json({ message: "disabled" }, status));
      await expect(geocodeAddress("A", "K", f)).rejects.toBeInstanceOf(KakaoAuthError);
    }
  });

  it("5xx·429·네트워크 실패는 error (notFound와 구분)", async () => {
    expect((await geocodeAddress("A", "K", vi.fn().mockResolvedValue(json({}, 500)))).status).toBe("error");
    expect((await geocodeAddress("A", "K", vi.fn().mockResolvedValue(json({}, 429)))).status).toBe("error");
    expect((await geocodeAddress("A", "K", vi.fn().mockRejectedValue(new Error("net")))).status).toBe("error");
  });
});

describe("geocodeMany — 여러 건", () => {
  it("입력 순서대로 결과를 돌려준다", async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      const q = new URL(String(url)).searchParams.get("query");
      return q === "B" ? json({ documents: [] }) : found("127", "37");
    });
    const r = await geocodeMany(["A", "B", "C"], "K", f as unknown as typeof fetch);
    expect(r.map((x) => [x.address, x.status])).toEqual([["A", "found"], ["B", "notFound"], ["C", "found"]]);
  });

  it("동시에 보내는 요청 수가 제한을 넘지 않는다", async () => {
    let running = 0;
    let maxRunning = 0;
    const f = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return found("127", "37");
    });
    await geocodeMany(Array.from({ length: 30 }, (_, i) => `주소${i}`), "K", f as unknown as typeof fetch, 5);
    expect(maxRunning).toBeLessThanOrEqual(5);
    expect(f).toHaveBeenCalledTimes(30);
  });
});

describe("POST /api/geocode", () => {
  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/geocode", { method: "POST", body: JSON.stringify(body) }));

  it("키가 없으면 500", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    expect((await post({ addresses: ["A"] })).status).toBe(500);
  });

  it("잘못된 입력은 400", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    for (const body of [{}, { addresses: [] }, { addresses: "A" }, { addresses: [1] }, { addresses: [""] }, { addresses: Array(101).fill("A") }]) {
      expect((await post(body)).status).toBe(400);
    }
  });

  it("정상이면 results를 돌려준다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "K");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(found("127.1", "37.2")));
    const res = await post({ addresses: ["서울 1-1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ address: "서울 1-1", status: "found", coord: { lat: 37.2, lng: 127.1 } }],
    });
  });

  it("카카오가 설정 문제로 거부하면 502와 안내 문구 (키 값은 노출하지 않음)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "TOPSECRETKEY");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "disabled" }, 403)));
    const res = await post({ addresses: ["A"] });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("MAP_SERVICE_REJECTED");
    expect(text).not.toContain("TOPSECRETKEY");
  });
});
