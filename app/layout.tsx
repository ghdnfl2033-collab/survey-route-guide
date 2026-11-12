import type { Metadata } from "next";
import { Archivo, Inter, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 글꼴은 빌드할 때 내려받아 이 서버에서 직접 내보낸다 (실행 중에 외부 글꼴 서버를 부르지 않는다)
// 큰 제목용 Archivo(굵고 좁은 영문), 본문용 Inter(영문·숫자), 한글은 Noto Sans KR
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"], display: "block" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "block" });
const notoKr = Noto_Sans_KR({ variable: "--font-noto-kr", weight: ["400", "500", "700", "900"], preload: false, display: "swap" });

export const metadata: Metadata = {
  title: "실태조사 길잡이",
  description: "국유재산 실태조사 방문 순서를 이동 수단별로 가장 짧게 계산해 줍니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${archivo.variable} ${inter.variable} ${notoKr.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
