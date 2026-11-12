"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Mosaic from "@/components/login/Mosaic";

// 입장 화면: 큰 제목과 접속 코드 입력 + 움직이는 색 타일 모자이크 (접속 코드를 확인하는 동작은 그대로)
export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      setMessage(data?.error?.message ?? "입장하지 못했어요. 다시 시도해 주세요.");
    } catch {
      setMessage("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-stage">
      <header className="hdr-card login-hdr flex items-center justify-between gap-4 px-5 py-4 md:px-8">
        <div>
          <p className="brand">실태조사 길잡이</p>
          <p className="brand-sub mt-1">국유재산 실태조사 · 방문 순서 계산</p>
        </div>
        <span className="text-sm font-medium text-[var(--nav-muted)]">접속 코드로 입장</span>
      </header>

      <div className="login-body">
        <section className="hero-copy">
          <h1 className="hero-h1">
            <span className="ln"><span>가장 짧은</span></span>
            <span className="ln"><span>방문 순서를</span></span>
            <span className="ln"><span>한 번에</span></span>
          </h1>
          <p className="hero-p">
            엑셀 필지 목록을 올리면 자차·대중교통·도보별로 <strong>총 소요 시간이 가장 짧은 순서</strong>를 계산해 지도와 표로 보여 주고, 엑셀로 내려받게 해 드려요.
          </p>

          <form onSubmit={submit} className="hero-acts space-y-3">
            <label className="block text-sm font-medium" htmlFor="access-code">
              접속 코드
            </label>
            <div className="flex items-center gap-2">
              <input
                id="access-code"
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                autoComplete="off"
                className="min-w-0 flex-1 border border-[var(--nav-rule)] bg-white px-4 py-3 text-base"
              />
              <button type="submit" disabled={busy || code.length === 0} className="pill-ink shrink-0 disabled:opacity-50">
                {busy ? "확인 중…" : "입장하기"}
                <span className="arrow-dot" style={{ background: "#fff", color: "var(--ink)" }} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            </div>
            {message && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {message}
              </p>
            )}
          </form>
        </section>

        <Mosaic />
      </div>
    </main>
  );
}
