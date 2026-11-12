import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  createSessionToken,
  safeEqual,
  sessionSecret,
} from "@/lib/server/session";

// 같은 접속지에서 5분에 10번 넘게 틀리면 잠시 막는다 (서버 메모리, 저장 안 함)
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const accessCode = process.env.ACCESS_CODE;
  const secret = sessionSecret();
  if (!accessCode || !secret) {
    return error(500, "NOT_CONFIGURED", "서버에 접속 코드가 설정되지 않았어요. 관리자에게 알려 주세요.");
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();

  // 시도 횟수는 "첫 await 전에" 확인하고 바로 올린다. 본문을 읽는 사이(await)에 동시 요청이 끼어들어도
  // 요청마다 한 번씩 정확히 세어지므로, 한꺼번에 많이 보내도 10번을 넘게 시도할 수 없다.
  const current = attempts.get(ip);
  const entry = current && current.resetAt > now ? current : { count: 0, resetAt: now + WINDOW_MS };
  if (entry.count >= MAX_ATTEMPTS) {
    return error(429, "TOO_MANY_REQUESTS", "너무 여러 번 틀렸어요. 잠시 뒤에 다시 시도해 주세요.");
  }
  entry.count += 1;
  attempts.set(ip, entry);

  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    entry.count -= 1; // 코드를 맞혀 보려는 시도가 아니라 잘못된 요청이므로 횟수에서 뺀다
    return error(400, "INVALID_INPUT", "접속 코드를 입력해 주세요.");
  }
  if (typeof code !== "string" || code.length === 0 || code.length > 200) {
    entry.count -= 1;
    return error(400, "INVALID_INPUT", "접속 코드를 입력해 주세요.");
  }

  if (!safeEqual(code, accessCode)) {
    // 틀릴 때마다 1초 늦춰서 무작위 대입을 느리게 만든다 (횟수는 위에서 이미 올렸다)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return error(401, "UNAUTHORIZED", "코드가 맞지 않아요.");
  }

  attempts.delete(ip);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return Response.json({ ok: true });
}
