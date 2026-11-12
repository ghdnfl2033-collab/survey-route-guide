import { describe, expect, it } from "vitest";
import { ForecastAuthError, fetchWeather, readForecastItems } from "@/lib/server/kma";
import { centerOf, fetchForecasts } from "@/lib/client/weather";

const KST_NOON = new Date("2026-11-12T12:00:00Z"); // 한국 시각 12:00을 UTC처럼 담은 값
const SEOUL = { lat: 37.5665, lng: 126.978 };

const okBody = (items: object[]) => ({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items: { item: items } } } });
const row = (fcstDate: string, fcstTime: string, category: string, fcstValue: string) => ({ baseDate: "20261112", baseTime: "1100", fcstDate, fcstTime, category, fcstValue, nx: 60, ny: 127 });
const sample = [row("20261113", "0900", "TMP", "5"), row("20261113", "1500", "TMP", "11"), row("20261113", "0900", "POP", "30"), row("20261113", "1500", "POP", "65"), row("20261113", "1500", "SKY", "3"), row("20261113", "1500", "PTY", "0")];

function fakeFetch(body: unknown, init: { status?: number; text?: string } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return new Response(init.text ?? JSON.stringify(body), { status: init.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("fetchWeather — 기상청 단기예보", () => {
  it("격자 번호와 발표 시각을 계산해 요청하고 날짜별 요약을 돌려준다", async () => {
    const f = fakeFetch(okBody(sample));
    const days = await fetchWeather(SEOUL, "KEY/+=", KST_NOON, f.impl);
    const url = new URL(f.calls[0]);
    expect(url.searchParams.get("nx")).toBe("60");
    expect(url.searchParams.get("ny")).toBe("127");
    expect(url.searchParams.get("base_date")).toBe("20261112");
    expect(url.searchParams.get("base_time")).toBe("1100");
    expect(url.searchParams.get("serviceKey")).toBe("KEY/+="); // 특수문자가 든 키도 그대로 전달된다
    expect(url.searchParams.get("dataType")).toBe("JSON");
    expect(days).toEqual([{ date: "2026-11-13", tempMin: 5, tempMax: 11, popMax: 65, sky: "구름 많음", precipitation: "없음" }]);
  });

  it("요청에는 격자 번호만 들어가고 좌표 원본은 들어가지 않는다", async () => {
    const f = fakeFetch(okBody(sample));
    await fetchWeather(SEOUL, "K", KST_NOON, f.impl);
    expect(f.calls[0]).not.toContain("37.56");
    expect(f.calls[0]).not.toContain("126.97");
  });

  it("키가 거부되면 ForecastAuthError (HTTP 401, 또는 200에 담긴 키 오류 XML, 또는 결과 코드 30)", async () => {
    await expect(fetchWeather(SEOUL, "K", KST_NOON, fakeFetch(null, { status: 401, text: "x" }).impl)).rejects.toBeInstanceOf(ForecastAuthError);
    const xml = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>";
    await expect(fetchWeather(SEOUL, "K", KST_NOON, fakeFetch(null, { text: xml }).impl)).rejects.toBeInstanceOf(ForecastAuthError);
    const code30 = { response: { header: { resultCode: "30", resultMsg: "x" } } };
    await expect(fetchWeather(SEOUL, "K", KST_NOON, fakeFetch(code30).impl)).rejects.toBeInstanceOf(ForecastAuthError);
  });

  it("다른 결과 코드·깨진 응답은 일반 오류다", async () => {
    const code99 = { response: { header: { resultCode: "99", resultMsg: "x" } } };
    await expect(fetchWeather(SEOUL, "K", KST_NOON, fakeFetch(code99).impl)).rejects.not.toBeInstanceOf(ForecastAuthError);
    await expect(fetchWeather(SEOUL, "K", KST_NOON, fakeFetch(null, { text: "<html>" }).impl)).rejects.toThrow();
  });
});

describe("readForecastItems", () => {
  it("형식이 다르면 null, 필요한 칸이 없는 줄은 버린다", () => {
    expect(readForecastItems({})).toBeNull();
    expect(readForecastItems(okBody([row("20261113", "0900", "TMP", "5"), { category: "TMP" }]))).toHaveLength(1);
  });
});

describe("클라이언트 fetchForecasts", () => {
  const day = { date: "2026-11-13", tempMin: 1, tempMax: 9, popMax: 20, sky: "맑음", precipitation: "없음" };

  it("좌표만 보내고 날씨 목록을 받는다", async () => {
    let sent = "";
    const impl = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return Response.json({ forecasts: [day] });
    }) as unknown as typeof fetch;
    expect(await fetchForecasts(SEOUL, impl)).toEqual([day]);
    expect(Object.keys(JSON.parse(sent)).sort()).toEqual(["lat", "lng"]);
  });

  it("실패·형식 오류·연결 오류는 오류를 던지지 않고 null이다", async () => {
    expect(await fetchForecasts(SEOUL, (async () => Response.json({}, { status: 502 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchForecasts(SEOUL, (async () => Response.json({ forecasts: [{ date: 1 }] })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchForecasts(SEOUL, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("centerOf", () => {
  it("좌표들의 가운데를 구하고, 비면 null이다", () => {
    expect(centerOf([{ lat: 37, lng: 127 }, { lat: 39, lng: 129 }])).toEqual({ lat: 38, lng: 128 });
    expect(centerOf([])).toBeNull();
  });
});
