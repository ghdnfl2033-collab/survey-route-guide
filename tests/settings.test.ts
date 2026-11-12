import { describe, expect, it } from "vitest";
import { todayString, validateSettings, type SettingsDraft } from "@/lib/core/settings";

const TODAY = "2026-11-12";
const draft = (over: Partial<SettingsDraft> = {}): SettingsDraft => ({
  originAddress: "서울 중구 세종대로 110",
  originCoord: { lat: 37.5666, lng: 126.9782 },
  date: "2026-11-20",
  departTime: "09:00",
  endMode: "return",
  mode: "car",
  inspectMinutes: "10",
  ...over,
});

describe("validateSettings — 동선 설정 검사", () => {
  it("올바른 입력은 설정으로 바뀐다 (조사 시간은 숫자)", () => {
    const r = validateSettings(draft(), TODAY);
    expect(r).toEqual({
      ok: true,
      settings: {
        origin: { address: "서울 중구 세종대로 110", coord: { lat: 37.5666, lng: 126.9782 } },
        date: "2026-11-20",
        departTime: "09:00",
        endMode: "return",
        mode: "car",
        inspectMinutes: 10,
      },
    });
  });

  it("출발지 주소의 앞뒤 공백은 지운다", () => {
    const r = validateSettings(draft({ originAddress: "  서울 1-1  " }), TODAY);
    expect(r.ok && r.settings.origin.address).toBe("서울 1-1");
  });

  it("주소가 비어도 지도에서 찍은 위치가 있으면 통과한다", () => {
    const r = validateSettings(draft({ originAddress: "  " }), TODAY);
    expect(r.ok && r.settings.origin.address).toBe("지도에서 찍은 위치");
  });

  it("출발지 주소도 위치도 없거나 위치만 없으면 안내한다", () => {
    expect(validateSettings(draft({ originAddress: "", originCoord: null }), TODAY)).toMatchObject({ ok: false, errors: { origin: expect.any(String) } });
    expect(validateSettings(draft({ originCoord: null }), TODAY)).toMatchObject({ ok: false, errors: { origin: expect.any(String) } });
  });

  it("출발지가 대한민국 밖이면 거부한다", () => {
    expect(validateSettings(draft({ originCoord: { lat: 35.68, lng: 139.69 } }), TODAY).ok).toBe(false);
  });

  it("오늘은 되고 어제는 안 된다", () => {
    expect(validateSettings(draft({ date: TODAY }), TODAY).ok).toBe(true);
    const r = validateSettings(draft({ date: "2026-11-11" }), TODAY);
    expect(r.ok === false && r.errors.date).toBeTruthy();
  });

  it("날짜가 비었거나 실제로 없는 날짜면 거부한다", () => {
    for (const date of ["", "2026-02-30", "2026-13-01", "abc", "2026/11/20"]) {
      const r = validateSettings(draft({ date }), TODAY);
      expect(r.ok === false && r.errors.date).toBeTruthy();
    }
  });

  it("출발 시각은 00:00~23:59 형식만 받는다", () => {
    for (const departTime of ["", "9:00", "24:00", "09:60", "abc"]) {
      const r = validateSettings(draft({ departTime }), TODAY);
      expect(r.ok === false && r.errors.departTime).toBeTruthy();
    }
    expect(validateSettings(draft({ departTime: "00:00" }), TODAY).ok).toBe(true);
    expect(validateSettings(draft({ departTime: "23:59" }), TODAY).ok).toBe(true);
  });

  it("조사 시간은 0~240분 정수만 받는다", () => {
    for (const inspectMinutes of ["0", "10", "240"]) {
      expect(validateSettings(draft({ inspectMinutes }), TODAY).ok).toBe(true);
    }
    for (const inspectMinutes of ["", "-1", "241", "1.5", "abc", "1000"]) {
      const r = validateSettings(draft({ inspectMinutes }), TODAY);
      expect(r.ok === false && r.errors.inspectMinutes).toBeTruthy();
    }
  });

  it("틀린 항목을 한꺼번에 모두 알려 준다", () => {
    const r = validateSettings(draft({ originAddress: "", originCoord: null, date: "", departTime: "x", inspectMinutes: "-5" }), TODAY);
    expect(r.ok === false && Object.keys(r.errors).sort()).toEqual(["date", "departTime", "inspectMinutes", "origin"]);
  });

  it("이동 수단과 끝내는 곳은 그대로 담긴다", () => {
    const r = validateSettings(draft({ mode: "transit", endMode: "lastParcel" }), TODAY);
    expect(r.ok && [r.settings.mode, r.settings.endMode]).toEqual(["transit", "lastParcel"]);
  });
});

describe("todayString", () => {
  it("YYYY-MM-DD로 만든다 (월·일은 두 자리)", () => {
    expect(todayString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayString(new Date(2026, 10, 12))).toBe("2026-11-12");
  });
});
