// Design Ref: §4.3 대중교통 — 카카오맵 대중교통 경로 API로 지정한 구간의 소요 시간·환승 횟수를 가져온다 (서버 전용)
// Plan SC: PRD 5장 must 2 — 대중교통은 걷는 구간과 환승을 포함한 시간, 구간마다 환승 횟수 표시,
//          경로가 없으면 도보로 대신 계산하고 "도보 구간" 표시
// 개인정보: 좌표만 보내고, 서버에 저장하거나 로그에 남기지 않는다.
//
// 이 API는 한 번에 한 구간만 조회한다 (하루 무료 1,000건). 응답에는 후보 경로가 여러 개 오는데
// 첫 번째가 가장 빠른 것은 아니라서, 총 소요 시간이 가장 짧은 경로를 직접 고른다.
// 순서가 정해진 뒤 그 순서의 구간(최대 31개)만 조회한다. 지금 운행 중인 노선 기준이다 (출발 시각 지정 없음).

import type { Coord, Ride } from "@/lib/core/types";
import { KakaoAuthError } from "./kakao";
import { fetchWalkLeg, MAX_WALK_LEGS } from "./kakaoWalk";

const TRANSIT_URL = "https://dapi.kakao.com/v2/routing/publictraffic";
const CALL_TIMEOUT_MS = 4000;
export const TRANSIT_CONCURRENCY = 5;
/** 구간 조회 전체에 쓸 수 있는 시간(밀리초). 지나면 남은 구간은 조회하지 않고 추정값으로 남긴다. */
export const TRANSIT_BUDGET_MS = 8000;
/** 한 번에 조회할 수 있는 최대 구간 수 (도보와 같음: 출발지 → 필지 30개 → 출발지) */
export const MAX_TRANSIT_LEGS = MAX_WALK_LEGS;

/** 이 상태값이면 "대중교통으로 갈 경로가 없다"는 뜻이라 도보로 대신 계산한다 (너무 가까운 거리 등) */
const NO_ROUTE_STATUSES = new Set(["NO_RESULTS", "STARTNODES_NULL", "ENDNODES_NULL"]);

export type TransitLegResult =
  /** 대중교통(또는 걷기로 대신한 구간)으로 구한 값. walk가 true면 대중교통 경로가 없어 걸어서 가는 "도보 구간" */
  | { ok: true; minutes: number; km: number; transfers: number; walk: boolean; lines?: string[]; rides?: Ride[] }
  /** 못 구한 이유: 카카오 상태값(NO_RESULTS 등), 호출 실패나 미조회는 null */
  | { ok: false; status: string | null };

const round2 = (v: number) => Math.round(v * 100) / 100;

type TransitStep = { properties?: { type?: string; vehicles?: { name?: string }[]; stops?: { name?: string }[] } };
type TransitRoute = { properties?: { totalDistance?: number; totalTime?: number; transfers?: number }; steps?: TransitStep[] };

/**
 * 경로에서 타고 가는 노선 이름을 탑승 순서대로 뽑는다. 예: ["2호선", "신분당선"], ["버스 402"].
 * 걷는 단계는 건너뛴다. 같은 구간에 탈 수 있는 버스가 여러 대면 "버스 470 외 1대"처럼 적는다.
 */
export function routeLines(route: TransitRoute): string[] {
  const lines: string[] = [];
  for (const step of route.steps ?? []) {
    const type = step.properties?.type;
    const names = (step.properties?.vehicles ?? []).map((v) => v?.name).filter((n): n is string => typeof n === "string" && n !== "");
    if (names.length === 0) continue;
    if (type === "SUBWAY") lines.push(names[0]);
    else if (type === "BUS") lines.push(`버스 ${names[0]}${names.length > 1 ? ` 외 ${names.length - 1}대` : ""}`);
  }
  return lines;
}
type TransitResponse = { status?: string; routes?: TransitRoute[] };

/** 경로에서 타는 노선마다 이름·승차·하차 정류장·정차 수를 뽑는다 (routeLines와 같은 순서). */
export function routeRides(route: TransitRoute): Ride[] {
  const rides: Ride[] = [];
  for (const step of route.steps ?? []) {
    const type = step.properties?.type;
    if (type !== "SUBWAY" && type !== "BUS") continue;
    const names = (step.properties?.vehicles ?? []).map((v) => v?.name).filter((n): n is string => typeof n === "string" && n !== "");
    if (names.length === 0) continue;
    const name = type === "SUBWAY" ? names[0] : `버스 ${names[0]}${names.length > 1 ? ` 외 ${names.length - 1}대` : ""}`;
    const stops = (step.properties?.stops ?? []).map((s) => s?.name).filter((n): n is string => typeof n === "string" && n !== "");
    rides.push(stops.length >= 2 ? { name, from: stops[0], to: stops[stops.length - 1], stops: stops.length - 1 } : { name });
  }
  return rides;
}

/** 후보 경로 중 총 소요 시간이 가장 짧은 경로를 고른다 (같으면 환승이 적은 쪽) */
export function pickFastestRoute(routes: readonly TransitRoute[]): { minutes: number; km: number; transfers: number; lines?: string[]; rides?: Ride[] } | null {
  let best: { seconds: number; meters: number; transfers: number; route: TransitRoute } | null = null;
  for (const r of routes) {
    const seconds = r.properties?.totalTime;
    const meters = r.properties?.totalDistance;
    const transfers = r.properties?.transfers ?? 0;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || typeof meters !== "number" || !Number.isFinite(meters)) continue;
    if (!best || seconds < best.seconds || (seconds === best.seconds && transfers < best.transfers)) {
      best = { seconds, meters, transfers, route: r };
    }
  }
  if (!best) return null;
  const lines = routeLines(best.route);
  const rides = routeRides(best.route);
  return {
    minutes: round2(best.seconds / 60),
    km: round2(best.meters / 1000),
    transfers: best.transfers,
    ...(lines.length > 0 ? { lines } : {}),
    ...(rides.length > 0 ? { rides } : {}),
  };
}

/** 두 지점 사이의 대중교통 소요 시간·환승 횟수 한 구간 (도보로 대신하는 처리는 하지 않음) */
export async function fetchTransitLeg(
  from: Coord,
  to: Coord,
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TransitLegResult> {
  const url = `${TRANSIT_URL}?${new URLSearchParams({
    start_x: String(from.lng),
    start_y: String(from.lat),
    end_x: String(to.lng),
    end_y: String(to.lat),
  })}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `KakaoAK ${restKey}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: null };
  }

  if (res.status === 401 || res.status === 403) throw new KakaoAuthError();
  if (!res.ok) return { ok: false, status: null };

  let body: TransitResponse;
  try {
    body = (await res.json()) as TransitResponse;
  } catch {
    return { ok: false, status: null };
  }

  if (body.status === "EQUAL_POINTS") return { ok: true, minutes: 0, km: 0, transfers: 0, walk: false };
  if (body.status === "OK") {
    const best = pickFastestRoute(body.routes ?? []);
    if (best) return { ok: true, ...best, walk: false };
  }
  return { ok: false, status: typeof body.status === "string" ? body.status : null };
}

/** 대중교통 경로가 없는 구간은 걷는 시간으로 대신한다 ("도보 구간"). 걷는 길도 못 구하면 실패로 남긴다. */
async function fetchLegWithWalkFallback(from: Coord, to: Coord, restKey: string, fetchImpl: typeof fetch): Promise<TransitLegResult> {
  const transit = await fetchTransitLeg(from, to, restKey, fetchImpl);
  if (transit.ok || transit.status === null || !NO_ROUTE_STATUSES.has(transit.status)) return transit;

  const walk = await fetchWalkLeg(from, to, restKey, fetchImpl);
  if (walk.ok) return { ok: true, minutes: walk.minutes, km: walk.km, transfers: 0, walk: true };
  return transit;
}

/**
 * 지점 목록을 순서대로 이은 구간들(points[i] → points[i+1])의 대중교통 시간·환승 횟수를 구한다.
 * 결과는 구간 순서와 같다. 시간 예산이 지나면 남은 구간은 조회하지 않고 status null로 남긴다.
 * 인증 문제(키·서비스 설정)는 KakaoAuthError로 던진다.
 */
export async function fetchTransitLegs(
  points: readonly Coord[],
  restKey: string,
  options: { fetchImpl?: typeof fetch; budgetMs?: number; now?: () => number } = {},
): Promise<TransitLegResult[]> {
  const { fetchImpl = fetch, budgetMs = TRANSIT_BUDGET_MS, now = Date.now } = options;
  const deadline = now() + budgetMs;
  const results: TransitLegResult[] = Array.from({ length: Math.max(points.length - 1, 0) }, () => ({ ok: false, status: null }));

  let next = 0;
  async function worker() {
    while (next < results.length) {
      const i = next++;
      if (now() >= deadline) continue;
      results[i] = await fetchLegWithWalkFallback(points[i], points[i + 1], restKey, fetchImpl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRANSIT_CONCURRENCY, results.length) }, worker));
  return results;
}
