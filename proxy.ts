import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySessionToken } from "@/lib/server/session";

// Design Ref: §6 — 모든 화면·API 앞에서 접속 코드 통과 여부를 확인하는 문지기
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 입장 화면과 코드 확인 API는 통과 전에도 열려 있어야 한다
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const ok = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionSecret(),
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "접속 코드를 먼저 입력해 주세요." } },
      { status: 401 },
    );
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // 정적 파일(_next, 아이콘)은 제외
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
