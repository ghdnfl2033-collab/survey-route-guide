import type { ReactNode } from "react";

// 로그인 화면 오른쪽의 색 타일 모자이크 (장식). 세 줄이 서로 반대 방향으로 끝없이 흐른다.
// 한 줄에 5칸을 두 번 이어 붙여(총 10칸) 절반만 움직여도 처음과 같은 모양이 되어 끊김 없이 이어진다.

const Pin = () => (
  <svg viewBox="0 0 32 40" fill="none" aria-hidden="true">
    <path d="M16 38s12-12.5 12-22A12 12 0 0 0 4 16c0 9.5 12 22 12 22Z" fill="currentColor" />
    <circle cx="16" cy="16" r="4.5" fill="var(--paper)" />
  </svg>
);
const Route = () => (
  <svg viewBox="0 0 48 40" fill="none" aria-hidden="true">
    <path d="M6 34c14 0 4-26 18-26s6 24 18 24" stroke="currentColor" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" />
    <circle cx="6" cy="34" r="4" fill="currentColor" />
    <circle cx="42" cy="32" r="4" fill="currentColor" />
  </svg>
);
const Clock = () => (
  <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="20" cy="20" r="17" stroke="currentColor" strokeWidth="3.5" />
    <path d="M20 10v10l7 4" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
);
const Sheet = () => (
  <svg viewBox="0 0 36 44" fill="none" aria-hidden="true">
    <path d="M4 4h20l8 8v28H4V4Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <path d="M10 22h16M10 30h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

type Tile = { kind: "red" | "yellow" | "blue" | "cream" | "dark"; icon?: ReactNode; big?: string; tag?: string };

const COLUMNS: Tile[][] = [
  [
    { kind: "red", big: "1", tag: "엑셀 올리기" },
    { kind: "cream", icon: <Pin />, tag: "위치 찾기" },
    { kind: "dark", big: "30", tag: "필지까지 한 번에" },
    { kind: "blue", icon: <Route /> },
    { kind: "yellow", big: "2", tag: "필지 고르기" },
  ],
  [
    { kind: "yellow", icon: <Clock />, tag: "조사 시간 포함" },
    { kind: "blue", big: "3", tag: "이동 수단 고르기" },
    { kind: "dark", icon: <Route />, tag: "가장 짧은 순서" },
    { kind: "red", icon: <Pin /> },
    { kind: "cream", big: "4", tag: "지도와 표로 보기" },
  ],
  [
    { kind: "blue", icon: <Sheet />, tag: "엑셀로 내려받기" },
    { kind: "cream", big: "5", tag: "현장에서 기록" },
    { kind: "red", icon: <Clock />, tag: "출발 시각부터" },
    { kind: "yellow", icon: <Pin /> },
    { kind: "dark", big: "↗", tag: "한눈에 보는 동선" },
  ],
];

export default function Mosaic() {
  return (
    <div className="mosaic" aria-hidden="true">
      {COLUMNS.map((tiles, c) => (
        <div key={c} className={`col c${c + 1}`}>
          {[...tiles, ...tiles].map((t, i) => (
            <div key={i} className={`cell ${t.kind}`}>
              {t.icon}
              {t.big && <span className="big">{t.big}</span>}
              {t.tag && <span className="tag">{t.tag}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
