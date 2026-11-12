// Design Ref: §6 — 접속 코드 통과 쿠키 (서명된 값, 12시간 유효)
// 웹 표준 암호화(Web Crypto)만 써서 proxy.ts와 Route Handler 양쪽에서 같이 쓴다.

export const SESSION_COOKIE = "survey_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 12;

const encoder = new TextEncoder();

/** 쿠키 서명 키: 비밀 값 + 접속 코드. 접속 코드를 바꾸면 이미 발급된 쿠키가 모두 무효가 된다. */
export function sessionSecret(): string | undefined {
  const secret = process.env.SESSION_SECRET;
  const code = process.env.ACCESS_CODE;
  return secret && code ? `${secret}:${code}` : undefined;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 두 문자열을 같은 시간에 비교 (맞는 글자 위치로 정답을 짐작하지 못하게) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload = String(expires);
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!token || !secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = await sign(payload, secret);
  if (!safeEqual(signature, expected)) return false;
  return Number(payload) > Date.now();
}
