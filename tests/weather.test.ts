import { describe, expect, it } from "vitest";
import { latestBaseTime, RAIN_ALERT_POP, summarizeForecast, toForecastGrid, weatherAdvice, type DayWeather, type ForecastItem } from "@/lib/core/weather";

describe("toForecastGrid — 위도·경도 → 기상청 격자", () => {
  it("서울시청 근처는 (60, 127)이다", () => {
    expect(toForecastGrid({ lat: 37.5665, lng: 126.978 })).toEqual({ nx: 60, ny: 127 });
  });
  it("부산시청 근처는 (98, 76), 제주시청 근처는 (53, 38)이다 (기상청 격자표 기준)", () => {
    expect(toForecastGrid({ lat: 35.1796, lng: 129.0756 })).toEqual({ nx: 98, ny: 76 });
    expect(toForecastGrid({ lat: 33.4996, lng: 126.5312 })).toEqual({ nx: 53, ny: 38 });
  });
});

describe("latestBaseTime — 가장 최근 예보 발표 시각", () => {
  const kst = (iso: string) => new Date(iso + "Z"); // 한국 시각을 UTC처럼 담는다
  it("발표 10분 뒤부터 새 발표를 쓴다", () => {
    expect(latestBaseTime(kst("2026-11-12T05:09:00"))).toEqual({ baseDate: "20261112", baseTime: "0200" });
    expect(latestBaseTime(kst("2026-11-12T05:10:00"))).toEqual({ baseDate: "20261112", baseTime: "0500" });
    expect(latestBaseTime(kst("2026-11-12T13:00:00"))).toEqual({ baseDate: "20261112", baseTime: "1100" });
    expect(latestBaseTime(kst("2026-11-12T23:30:00"))).toEqual({ baseDate: "20261112", baseTime: "2300" });
  });
  it("오늘 02:10 전이면 어제 23시 발표를 쓴다 (월이 바뀌어도)", () => {
    expect(latestBaseTime(kst("2026-11-12T01:00:00"))).toEqual({ baseDate: "20261111", baseTime: "2300" });
    expect(latestBaseTime(kst("2026-12-01T00:05:00"))).toEqual({ baseDate: "20261130", baseTime: "2300" });
  });
});

const item = (fcstDate: string, fcstTime: string, category: string, fcstValue: string): ForecastItem => ({ fcstDate, fcstTime, category, fcstValue });

describe("summarizeForecast — 날짜별 날씨 요약", () => {
  const items: ForecastItem[] = [
    // 13일: 기온 3~12℃, 낮 강수 확률 최대 70%, 하늘 흐림, 비
    ...["0300", "0600", "0900", "1200", "1500", "1800", "2100"].flatMap((t, i) => [
      item("20261113", t, "TMP", String([3, 4, 8, 12, 11, 7, 5][i])),
      item("20261113", t, "POP", String([90, 20, 40, 70, 60, 30, 10][i])), // 03시의 90%는 조사 시간대가 아니라 제외
      item("20261113", t, "SKY", "4"),
      item("20261113", t, "PTY", i === 3 ? "1" : "0"),
    ]),
    // 14일: 맑고 비 없음
    ...["0600", "1200", "1800"].flatMap((t, i) => [
      item("20261114", t, "TMP", String([1, 9, 6][i])),
      item("20261114", t, "POP", "10"),
      item("20261114", t, "SKY", "1"),
      item("20261114", t, "PTY", "0"),
    ]),
  ];

  it("날짜별로 최저·최고 기온, 조사 시간대 최대 강수 확률, 하늘, 강수 형태를 요약한다", () => {
    const [d13, d14] = summarizeForecast(items);
    expect(d13).toEqual({ date: "2026-11-13", tempMin: 3, tempMax: 12, popMax: 70, sky: "흐림", precipitation: "비" });
    expect(d14).toEqual({ date: "2026-11-14", tempMin: 1, tempMax: 9, popMax: 10, sky: "맑음", precipitation: "없음" });
  });

  it("기상청이 하루 최저·최고 기온(TMN·TMX)을 따로 주면 그 값을 쓴다", () => {
    const withExtremes = [...items, item("20261114", "0600", "TMN", "-2.0"), item("20261114", "1500", "TMX", "10.0")];
    const d14 = summarizeForecast(withExtremes).find((d) => d.date === "2026-11-14")!;
    expect(d14.tempMin).toBe(-2);
    expect(d14.tempMax).toBe(10);
  });

  it("기온이나 강수 확률을 알 수 없는 날은 빼고, 빈 응답은 빈 목록이다", () => {
    expect(summarizeForecast([item("20261115", "0900", "TMP", "5")])).toEqual([]);
    expect(summarizeForecast([])).toEqual([]);
  });

  it("값이 숫자가 아니면 무시한다", () => {
    const bad = [item("20261113", "0900", "TMP", "-"), item("20261113", "0900", "POP", "20"), item("20261113", "1200", "TMP", "7")];
    expect(summarizeForecast(bad)[0].tempMax).toBe(7);
  });
});

describe("weatherAdvice — 비 예보 안내", () => {
  const w = (popMax: number, precipitation: DayWeather["precipitation"] = "비"): DayWeather => ({
    date: "2026-11-13",
    tempMin: 3,
    tempMax: 10,
    popMax,
    sky: "흐림",
    precipitation,
  });

  it("기준은 강수 확률 60%다", () => {
    expect(RAIN_ALERT_POP).toBe(60);
    expect(weatherAdvice(w(59), "walk").rainy).toBe(false);
    expect(weatherAdvice(w(60), "walk").rainy).toBe(true);
  });

  it("도보로 계획했으면 자차나 대중교통을 권한다", () => {
    expect(weatherAdvice(w(80), "walk").message).toContain("자차나 대중교통");
  });

  it("자차·대중교통이면 비 예보만 알린다 (도보를 권하지 않는다)", () => {
    for (const mode of ["car", "transit"] as const) {
      const m = weatherAdvice(w(80), mode).message;
      expect(m).toContain("비 예보");
      expect(m).not.toContain("도보 대신");
    }
  });

  it("눈이면 눈이라고 알린다", () => {
    expect(weatherAdvice(w(70, "눈"), "car").message).toContain("눈 예보");
  });

  it("비 예보가 아니면 안내 문구가 비어 있다", () => {
    expect(weatherAdvice(w(10, "없음"), "walk").message).toBe("");
  });
});
