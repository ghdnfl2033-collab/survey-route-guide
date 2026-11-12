import { describe, expect, it } from "vitest";
import { buildExportContent, exportFileName, legMarks } from "@/lib/core/exportRows";
import { planRoute, repricePlan } from "@/lib/core/route";
import type { Leg, Parcel, RouteSettings } from "@/lib/core/types";

const ORIGIN = { lat: 37.5665, lng: 126.978 };
const parcel = (n: number, dLat: number, rows: number[] = [n]): Parcel => ({
  id: `p-${n}`,
  address: `주소${n}`,
  rowNumbers: rows,
  coord: { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng },
  needsCheck: false,
});
const settings = (over: Partial<RouteSettings> = {}): RouteSettings => ({
  origin: { address: "서울 중구 세종대로 110", coord: ORIGIN },
  date: "2027-03-15",
  departTime: "09:00",
  endMode: "return",
  mode: "car",
  inspectMinutes: 10,
  ...over,
});
const three = [parcel(1, 0.01), parcel(2, 0.02, [5, 9]), parcel(3, 0.03)];

const leg = (over: Partial<Leg> = {}): Leg => ({ from: "a", to: "b", distanceKm: 1, minutes: 1, estimated: false, walkFallback: false, roadEndWalk: false, ...over });

describe("legMarks — 표시 글자", () => {
  it("아무 표시도 없으면 빈 글자", () => {
    expect(legMarks(leg(), leg())).toBe("");
    expect(legMarks(undefined, undefined)).toBe("");
  });

  it("추정값·도보 구간은 다음 구간(leg), 도로 끝 도보는 도착 구간(arrival) 기준이다", () => {
    expect(legMarks(leg({ estimated: true }), leg())).toBe("추정값");
    expect(legMarks(leg({ walkFallback: true }), leg())).toBe("도보 구간");
    expect(legMarks(leg(), leg({ roadEndWalk: true, roadEndMeters: 360 }))).toBe("도로 끝에서 도보 이동 필요 (약 360m)");
    expect(legMarks(leg(), leg({ roadEndWalk: true }))).toBe("도로 끝에서 도보 이동 필요");
  });

  it("여러 표시는 쉼표로 이어 붙인다", () => {
    expect(legMarks(leg({ walkFallback: true, estimated: true }), leg({ roadEndWalk: true, roadEndMeters: 150 }))).toBe(
      "도로 끝에서 도보 이동 필요 (약 150m), 도보 구간, 추정값",
    );
  });
});

describe("exportFileName", () => {
  it("조사 날짜와 이동 수단이 들어간다", () => {
    expect(exportFileName(settings({ mode: "transit" }))).toBe("실태조사_동선_2027-03-15_대중교통.xlsx");
    expect(exportFileName(settings({ mode: "walk" }))).toBe("실태조사_동선_2027-03-15_도보.xlsx");
  });

  it("파일 이름에 쓸 수 없는 글자(/ \\ : * ? \" < > |)가 없다", () => {
    for (const mode of ["car", "transit", "walk"] as const) {
      expect(exportFileName(settings({ mode }))).not.toMatch(/[\\/:*?"<>|]/);
    }
  });
});

describe("buildExportContent — 엑셀에 담을 내용", () => {
  it("요약에 조사 조건과 총 소요 시간이 들어간다", () => {
    const s = settings({ inspectMinutes: 15 });
    const plan = planRoute(s, three);
    const sum = new Map(buildExportContent(s, plan, three).summary);
    expect(sum.get("조사 날짜")).toBe("2027-03-15");
    expect(sum.get("출발지")).toBe("서울 중구 세종대로 110");
    expect(sum.get("출발 시각")).toBe("09:00");
    expect(sum.get("동선 끝내는 곳")).toBe("출발지로 돌아오기");
    expect(sum.get("이동 수단")).toBe("자차");
    expect(sum.get("필지당 조사 시간(분)")).toBe(15);
    expect(sum.get("방문할 필지 수")).toBe(3);
    expect(sum.has("총 소요 시간")).toBe(true);
    expect(sum.has("출발지 복귀 예정")).toBe(true);
  });

  it("마지막 필지에서 끝내기면 '조사 끝 예정'이다", () => {
    const s = settings({ endMode: "lastParcel" });
    const sum = new Map(buildExportContent(s, planRoute(s, three), three).summary);
    expect(sum.has("조사 끝 예정")).toBe(true);
    expect(sum.has("출발지 복귀 예정")).toBe(false);
  });

  it("표: 0번 출발지 줄, 필지 순번 줄, 복귀 줄 순서이고 열 수가 머리글과 같다", () => {
    const s = settings();
    const plan = planRoute(s, three);
    const c = buildExportContent(s, plan, three);
    expect(c.rows).toHaveLength(1 + 3 + 1);
    expect(c.rows[0][0]).toBe(0);
    expect(String(c.rows[0][1])).toContain("출발지");
    expect(c.rows.slice(1, 4).map((r) => r[0])).toEqual([1, 2, 3]);
    expect(String(c.rows.at(-1)![1])).toContain("복귀");
    c.rows.forEach((r) => expect(r).toHaveLength(c.header.length));
  });

  it("필지 줄에는 방문 순서대로 주소와 도착 시각, 원본 줄 번호가 들어간다 (합쳐진 주소는 줄 번호가 여러 개)", () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = planRoute(s, three);
    const c = buildExportContent(s, plan, three);
    const addrOf = (id: string) => three.find((p) => p.id === id)!.address;
    plan.orderIds.forEach((id, i) => {
      expect(c.rows[i + 1][1]).toBe(addrOf(id));
      expect(String(c.rows[i + 1][2])).toMatch(/^\d{2}:\d{2} 도착$/);
    });
    const p2 = c.rows.find((r) => r[1] === "주소2")!;
    expect(p2.at(-1)).toBe("5, 9");
  });

  it("거리·시간은 숫자로 들어가고(엑셀에서 계산 가능), 없는 값은 '-'이다", () => {
    const s = settings({ endMode: "lastParcel" });
    const plan = planRoute(s, three);
    const c = buildExportContent(s, plan, three);
    expect(typeof c.rows[0][3]).toBe("number");
    expect(typeof c.rows[0][4]).toBe("number");
    // 마지막 필지에서 끝내기: 마지막 줄은 다음 구간이 없다
    expect(c.rows.at(-1)![3]).toBe("-");
    expect(c.rows.at(-1)![4]).toBe("-");
  });

  it("복귀 설정이면 마지막 필지 줄에 출발지로 돌아오는 구간 값이 들어가고, 그 줄에 안내 문구가 붙는다", () => {
    const s = settings({ endMode: "return" });
    const plan = planRoute(s, three);
    const c = buildExportContent(s, plan, three);
    const lastParcelRow = c.rows[3];
    expect(String(lastParcelRow[1])).toContain("→ 출발지로 돌아오기");
    expect(lastParcelRow[4]).toBe(plan.legs.at(-1)!.minutes);
  });

  it("대중교통만 환승 횟수 열이 있다", () => {
    const car = buildExportContent(settings(), planRoute(settings(), three), three);
    expect(car.header).not.toContain("환승 횟수");
    const t = settings({ mode: "transit" });
    const plan = repricePlan(t, planRoute(t, three), planRoute(t, three).legs.map((_, i) => ({ ok: true as const, minutes: 10, km: 2, transfers: i % 3 })));
    const c = buildExportContent(t, plan, three);
    const col = c.header.indexOf("환승 횟수");
    expect(col).toBeGreaterThan(0);
    expect(c.rows[0][col]).toBe(0);
    expect(c.rows[2][col]).toBe(2);
    c.rows.forEach((r) => expect(r).toHaveLength(c.header.length));
  });

  it("표시 열: 추정값·도보 구간·도로 끝에서 도보 이동 필요가 들어간다", () => {
    const s = settings({ mode: "transit", endMode: "lastParcel" });
    const base = planRoute(s, three);
    const plan = repricePlan(s, base, [
      { ok: true, minutes: 10, km: 2, transfers: 1, walkFallback: true },
      { ok: false },
      { ok: true, minutes: 10, km: 2, transfers: 0 },
    ]);
    const c = buildExportContent(s, plan, three);
    const mark = c.header.indexOf("표시");
    expect(c.rows[0][mark]).toBe("도보 구간");
    expect(c.rows[1][mark]).toBe("추정값");
    expect(c.rows[2][mark]).toBe("");
  });

  it("안내 문구: 전체 추정이면 추정값 안내, 자차는 교통 상황 안내, 도로 끝 필지가 있으면 그 안내", () => {
    const s = settings();
    const allEstimated = buildExportContent(s, planRoute(s, three), three).notes.join("\n");
    expect(allEstimated).toContain("전체 구간이 추정값");
    expect(allEstimated).not.toContain("교통 상황");

    const plan = planRoute(s, three);
    const real = repricePlan(s, plan, plan.legs.map((l, i) => ({ ok: true as const, minutes: 10, km: 2, endGapMeters: i === 0 ? 400 : 3 })));
    const notes = buildExportContent(s, real, three).notes.join("\n");
    expect(notes).toContain("교통 상황");
    expect(notes).toContain("도로 끝에서 도보 이동 필요");
    expect(notes).not.toContain("추정값입니다");
  });

  it("일부만 추정이면 몇 개 구간인지 알려 준다", () => {
    const s = settings({ mode: "walk", endMode: "lastParcel" });
    const plan = repricePlan(s, planRoute(s, three), [{ ok: true, minutes: 5, km: 1 }, { ok: false }, { ok: true, minutes: 5, km: 1 }]);
    expect(buildExportContent(s, plan, three).notes.join("\n")).toContain("3개 구간 중 1개");
  });

  it("필지가 없어도 오류 없이 출발지 줄만 만든다", () => {
    const s = settings();
    const c = buildExportContent(s, planRoute(s, []), []);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0][3]).toBe("-");
  });

  it("엑셀 원본 개인정보: 내용에는 주소·좌표 외의 값이 들어가지 않는다 (주소와 줄 번호만)", () => {
    const s = settings();
    const c = buildExportContent(s, planRoute(s, three), three);
    const text = JSON.stringify(c);
    expect(text).not.toContain("coord");
    expect(text).not.toContain("lat");
  });
});

describe("조사 기록 열 (nice 1)", () => {
  const s = settings({ endMode: "lastParcel" });
  const plan = planRoute(s, three);

  it("기록을 안 주면 열이 없고, 주면 조사 완료·이용 현황·메모 열이 붙는다", () => {
    expect(buildExportContent(s, plan, three).header).not.toContain("메모");
    const c = buildExportContent(s, plan, three, {});
    expect(c.header.slice(-3)).toEqual(["조사 완료", "이용 현황", "메모"]);
    c.rows.forEach((r) => expect(r).toHaveLength(c.header.length));
  });

  it("필지 줄에 그 필지의 기록이 들어가고, 출발지 줄과 기록 없는 필지는 비어 있다", () => {
    const target = plan.orderIds[1];
    const c = buildExportContent(s, plan, three, { [target]: { parcelId: target, done: true, usage: "임대 중", memo: "담장 있음" } });
    expect(c.rows[2].slice(-3)).toEqual(["완료", "임대 중", "담장 있음"]);
    expect(c.rows[1].slice(-3)).toEqual(["", "", ""]);
    expect(c.rows[0].slice(-3)).toEqual(["", "", ""]);
  });

  it("복귀 줄에도 열 수가 맞는다", () => {
    const r = settings({ endMode: "return" });
    const c = buildExportContent(r, planRoute(r, three), three, {});
    c.rows.forEach((row) => expect(row).toHaveLength(c.header.length));
  });
});

describe("조사 완료로 제외한 필지 (작업 29)", () => {
  const s = settings({ endMode: "lastParcel" });
  const active = [three[0], three[2]];
  const gone = [three[1]];
  const plan = planRoute(s, active);
  const records = { "p-2": { parcelId: "p-2", done: true, usage: "자가 이용", memo: "완료" } };

  it("방문 순서에는 제외한 필지가 없고, 표 맨 아래에 기록과 함께 적힌다", () => {
    const c = buildExportContent(s, plan, active, records, gone);
    expect(plan.orderIds).not.toContain("p-2");
    const last = c.rows.at(-1)!;
    expect(String(last[1])).toContain("주소2 (조사 완료로 제외)");
    expect(last.slice(-3)).toEqual(["완료", "자가 이용", "완료"]);
    c.rows.forEach((r) => expect(r).toHaveLength(c.header.length));
  });

  it("안내 문구에 몇 곳을 뺐는지 적힌다", () => {
    expect(buildExportContent(s, plan, active, records, gone).notes.join("\n")).toContain("1개 필지는 방문 순서 계산에서 뺐습니다");
    expect(buildExportContent(s, plan, active, records).notes.join("\n")).not.toContain("조사 완료");
  });

  it("대중교통 표에서도 열 수가 맞는다", () => {
    const t = settings({ mode: "transit", endMode: "lastParcel" });
    const c = buildExportContent(t, planRoute(t, active), active, records, gone);
    c.rows.forEach((r) => expect(r).toHaveLength(c.header.length));
  });
});

describe("순서를 직접 바꾼 경우", () => {
  it("엑셀 안내 문구에 직접 바꿨다는 사실이 적히고, 13곳 이상 안내는 대신 빠진다", async () => {
    const { reorderPlan, moveInOrder } = await import("@/lib/core/route");
    const s = settings({ endMode: "lastParcel" });
    const plan = planRoute(s, three);
    const r = reorderPlan(s, plan, three, moveInOrder(plan.orderIds, 0, 2));
    const notes = buildExportContent(s, r.plan, three).notes.join("\n");
    expect(notes).toContain("방문 순서를 직접 바꿨습니다");
    expect(notes).not.toContain("13곳 이상");
    expect(buildExportContent(s, plan, three).notes.join("\n")).not.toContain("직접 바꿨습니다");
  });
});
