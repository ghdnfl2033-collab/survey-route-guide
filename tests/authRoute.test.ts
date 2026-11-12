import { beforeAll, describe, expect, it, vi } from "vitest";

// 쿠키를 심는 부분은 이 시험의 관심사가 아니므로 가짜로 바꾼다
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {} }) }));

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.ACCESS_CODE = "correct-code-123";
  process.env.SESSION_SECRET = "x".repeat(64);
  ({ POST } = await import("@/app/api/auth/route"));
});

let n = 0;
/** 시험마다 다른 접속지(IP)를 써서 서로 영향을 주지 않게 한다 */
const newIp = () => `10.0.0.${++n}`;
const attempt = (ip: string, body: unknown) =>
  POST(new Request("http://localhost/api/auth", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/auth — 접속 코드 확인과 무차별 대입 제한", () => {
  it("맞는 코드는 통과한다", async () => {
    expect((await attempt(newIp(), { code: "correct-code-123" })).status).toBe(200);
  });

  it("틀린 코드는 401이다", async () => {
    expect((await attempt(newIp(), { code: "nope" })).status).toBe(401);
  });

  it("한꺼번에 보낸 틀린 시도도 10번까지만 받고 나머지는 429로 막는다 (동시 요청 우회 방지)", async () => {
    const ip = newIp();
    const results = await Promise.all(Array.from({ length: 40 }, () => attempt(ip, { code: "wrong" })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(30);
  }, 15000);

  it("제한에 걸린 뒤에는 맞는 코드도 막힌다", async () => {
    const ip = newIp();
    await Promise.all(Array.from({ length: 12 }, () => attempt(ip, { code: "wrong" })));
    expect((await attempt(ip, { code: "correct-code-123" })).status).toBe(429);
  }, 15000);

  it("다른 접속지는 따로 센다", async () => {
    const blocked = newIp();
    await Promise.all(Array.from({ length: 12 }, () => attempt(blocked, { code: "wrong" })));
    expect((await attempt(newIp(), { code: "correct-code-123" })).status).toBe(200);
  }, 15000);

  it("잘못된 요청(본문 없음·빈 코드)은 400이고 시도 횟수에 넣지 않는다", async () => {
    const ip = newIp();
    for (let i = 0; i < 15; i++) {
      expect((await attempt(ip, "not json")).status).toBe(400);
      expect((await attempt(ip, { code: "" })).status).toBe(400);
    }
    expect((await attempt(ip, { code: "correct-code-123" })).status).toBe(200);
  });

  it("성공하면 그 접속지의 실패 횟수가 지워진다", async () => {
    const ip = newIp();
    for (let i = 0; i < 9; i++) await attempt(ip, { code: "wrong" });
    expect((await attempt(ip, { code: "correct-code-123" })).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await attempt(ip, { code: "wrong" })).status).toBe(401);
  }, 30000);
});
