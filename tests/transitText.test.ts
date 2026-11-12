import { describe, expect, it } from "vitest";
import { kakaoDirectionsUrl } from "@/lib/core/kakaoLink";
import { legRideTexts, rideText } from "@/lib/core/transitText";
import type { Leg } from "@/lib/core/types";

const leg = (over: Partial<Leg>): Leg => ({ from: "a", to: "b", distanceKm: 1, minutes: 1, estimated: false, walkFallback: false, roadEndWalk: false, ...over });

describe("이용 노선 안내 글자", () => {
  it("승차·하차와 정거장 수를 적는다", () => {
    expect(rideText({ name: "2호선", from: "을지로입구", to: "강남", stops: 21 })).toBe("2호선 을지로입구 승차 → 강남 하차 (21정거장)");
  });
  it("정류장 정보가 없으면 이름만", () => {
    expect(rideText({ name: "버스 402" })).toBe("버스 402");
  });
  it("rides가 없으면 lines, 도보 구간은 '도보', 아무 정보도 없으면 빈 목록", () => {
    expect(legRideTexts(leg({ lines: ["3호선"] }))).toEqual(["3호선"]);
    expect(legRideTexts(leg({ walkFallback: true }))).toEqual(["도보"]);
    expect(legRideTexts(leg({}))).toEqual([]);
    expect(legRideTexts(undefined)).toEqual([]);
  });
});

describe("카카오맵 길찾기 링크", () => {
  const A = { name: "서울 중구 세종대로 110", coord: { lat: 37.5663, lng: 126.9779 } };
  const B = { name: "강남구 역삼동, 1-2/3", coord: { lat: 37.4979, lng: 127.0276 } };
  it("수단에 맞는 주소와 출발·도착 좌표를 만든다", () => {
    const url = new URL(kakaoDirectionsUrl("transit", A, B));
    expect(url.origin).toBe("https://map.kakao.com");
    expect(url.pathname.startsWith("/link/by/traffic/")).toBe(true);
    const [, , , , from, to] = url.pathname.split("/");
    expect(decodeURIComponent(from)).toBe("서울 중구 세종대로 110,37.5663,126.9779");
    expect(decodeURIComponent(to)).toBe("강남구 역삼동 1-2 3,37.4979,127.0276");
  });
  it("자차·도보 주소", () => {
    expect(kakaoDirectionsUrl("car", A, B)).toContain("/link/by/car/");
    expect(kakaoDirectionsUrl("walk", A, B)).toContain("/link/by/walk/");
  });
});
