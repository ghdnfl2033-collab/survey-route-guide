// Design Ref: §4.3 자차 구간 시간표 — 카카오모빌리티 길찾기로 지점 사이 시간·거리를 가져온다 (서버 전용, 키는 서버에서만 사용)
// Plan SC: PRD 5장 must 2 — 길찾기 서비스 연결에 실패하면 직선거리로 대신 계산하고 "추정값"이라고 표시한다
// 개인정보: 좌표만 보내고, 서버에 저장하거나 로그에 남기지 않는다.
//
// 방식(실제 호출로 확인한 제약):
//  - 다중 목적지 길찾기: 한 번에 최대 30곳, 출발지 반경 10km 안의 목적지만 계산한다.
//    반경 밖 목적지는 result_code 304로 돌아온다. → 지점마다 한 번씩(최대 31번) 호출한다.
//  - 반경 밖 구간은 단건 길찾기로 보완한다 (호출 수·시간 예산 안에서만, 나머지는 추정값).
//  - 그래도 못 구한 구간은 직선거리 기반 추정값으로 채운다.

import { straightDistanceKm } from "@/lib/core/distance";
import { buildFallbackMatrix } from "@/lib/core/fallback";
import { distanceMeters, PROBE_RINGS_M, probeRing } from "@/lib/core/roadEnd";
import type { Coord } from "@/lib/core/types";
import { KakaoAuthError } from "./kakao";

const MULTI_URL = "https://apis-navi.kakaomobility.com/v1/destinations/directions";
const SINGLE_URL = "https://apis-navi.kakaomobility.com/v1/directions";

/** 다중 목적지 길찾기가 한 번에 받는 최대 목적지 수 */
export const MAX_DESTINATIONS = 30;
/** 다중 목적지 길찾기의 최대 반경(미터). 이보다 크게 요청하면 카카오가 400으로 거부한다. */
export const MULTI_RADIUS_M = 10000;
/** 반경을 벗어난 목적지에 카카오가 돌려주는 결과 코드 */
export const OUT_OF_RADIUS_CODE = 304;
const CALL_TIMEOUT_MS = 4000;
/**
 * 카카오 길찾기에 동시에 보내는 요청 수.
 * 흩어진 30필지는 다중 목적지 호출 1번이 0.4~1초 걸려서 31번을 동시 5개로 하면 약 3.6초, 8개로 하면 약 2.4초다.
 * (동시 16개까지 제한(429) 없이 성공하는 것을 확인했지만, 여러 직원이 함께 쓰는 경우를 생각해 8개로 둔다.)
 */
export const NAVI_CONCURRENCY = 8;
/** 반경 밖 구간을 단건으로 보완하는 최대 호출 수 */
export const MAX_SINGLE_CALLS = 60;
/** 길찾기 전체에 쓸 수 있는 시간(밀리초). 지나면 남은 구간은 추정값으로 채운다. */
export const DEFAULT_BUDGET_MS = 8000;
/**
 * 반경 밖 구간을 단건으로 보완하는 데 쓸 수 있는 시간(밀리초).
 * 이 보완은 방문 순서를 정하는 데만 쓰인다(최종 구간의 시간·거리는 순서가 정해진 뒤 다시 확인한다).
 * 서울 전역처럼 흩어진 필지 30곳은 10km 넘는 구간이 많아서 예산을 다 쓰게 되므로, 목표(30필지 자차 10초)를 지키려고 짧게 둔다.
 * 가까운 구간부터 조회하므로, 못 채운 먼 구간만 직선거리 추정값으로 남는다.
 */
export const DEFAULT_SINGLE_BUDGET_MS = 1500;
/** 이보다 가까운 두 지점은 같은 곳으로 본다 (km) */
const SAME_PLACE_KM = 0.005;

export type PairResult = { ok: true; minutes: number; km: number } | { ok: false; code: number | null };

const round2 = (v: number) => Math.round(v * 100) / 100;

function headers(restKey: string) {
  return { Authorization: `KakaoAK ${restKey}`, "Content-Type": "application/json" };
}

type NaviRoute = { key?: string; result_code?: number; summary?: { distance?: number; duration?: number } };

function toPair(route: NaviRoute | undefined): PairResult {
  const duration = route?.summary?.duration;
  const distance = route?.summary?.distance;
  if (route?.result_code === 0 && Number.isFinite(duration) && Number.isFinite(distance)) {
    return { ok: true, minutes: round2((duration as number) / 60), km: round2((distance as number) / 1000) };
  }
  return { ok: false, code: typeof route?.result_code === "number" ? route.result_code : null };
}

/** 한 지점에서 여러 목적지(최대 30곳)까지의 시간·거리를 한 번에 가져온다. key는 목적지 구분용 글자. */
export async function fetchMulti(
  origin: Coord,
  destinations: readonly { key: string; coord: Coord }[],
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, PairResult>> {
  const out = new Map<string, PairResult>();
  const failAll = () => destinations.forEach((d) => out.set(d.key, { ok: false, code: null }));

  let res: Response;
  try {
    res = await fetchImpl(MULTI_URL, {
      method: "POST",
      headers: headers(restKey),
      body: JSON.stringify({
        origin: { x: origin.lng, y: origin.lat },
        destinations: destinations.map((d) => ({ x: d.coord.lng, y: d.coord.lat, key: d.key })),
        radius: MULTI_RADIUS_M,
        priority: "TIME",
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    failAll();
    return out;
  }

  if (res.status === 401 || res.status === 403) throw new KakaoAuthError();
  if (!res.ok) {
    failAll();
    return out;
  }

  let routes: NaviRoute[] = [];
  try {
    routes = ((await res.json()) as { routes?: NaviRoute[] }).routes ?? [];
  } catch {
    failAll();
    return out;
  }
  const byKey = new Map(routes.map((r) => [r.key, r]));
  for (const d of destinations) out.set(d.key, toPair(byKey.get(d.key)));
  return out;
}

/** 두 지점 사이의 시간·거리를 한 구간만 가져온다 (반경 밖 구간 보완용). */
export async function fetchSingle(
  origin: Coord,
  destination: Coord,
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PairResult> {
  const url = `${SINGLE_URL}?${new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    priority: "TIME",
    summary: "true",
  })}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: headers(restKey),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: null };
  }

  if (res.status === 401 || res.status === 403) throw new KakaoAuthError();
  if (!res.ok) return { ok: false, code: null };
  try {
    const body = (await res.json()) as { routes?: NaviRoute[] };
    return toPair(body.routes?.[0]);
  } catch {
    return { ok: false, code: null };
  }
}

/** 항목을 동시에 최대 limit개씩 처리한다. */
async function runPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) await task(items[next++]);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export type CarMatrix = {
  /** minutes[a][b] = a에서 b까지 걸리는 시간(분) */
  minutes: number[][];
  /** km[a][b] = a에서 b까지의 거리(km) */
  km: number[][];
  /** true면 길찾기 결과가 아니라 직선거리 기반 추정값 ("추정값" 표시 대상) */
  estimated: boolean[][];
  /** 카카오가 돌려준 결과 코드 (성공 0, 반경 밖 304, 도로 없음 101~103 등, 호출 실패·미조회는 null) */
  codes: (number | null)[][];
  stats: { multiCalls: number; singleCalls: number; estimatedPairs: number };
};

/**
 * 지점 목록(0번이 출발지)의 모든 쌍에 대해 자차 시간·거리를 구한다. 길찾기로 못 구한 구간은 직선거리 추정값으로 채운다.
 * 인증 문제(키·서비스 설정)는 KakaoAuthError로 던진다.
 */
export async function buildCarMatrix(
  points: readonly Coord[],
  restKey: string,
  options: {
    fetchImpl?: typeof fetch;
    budgetMs?: number;
    maxSingleCalls?: number;
    singleBudgetMs?: number;
    now?: () => number;
    /**
     * 일부 지점의 좌표만 바뀐 뒤 시간표를 다시 만들 때: 이전 시간표(base)를 그대로 쓰고,
     * 이 지점 번호들과 관련된 구간만 다시 조회한다. (도로 끝으로 옮긴 필지를 처리할 때 전체를 다시 계산하지 않으려고)
     */
    base?: CarMatrix;
    onlyPairsInvolving?: ReadonlySet<number>;
  } = {},
): Promise<CarMatrix> {
  const {
    fetchImpl = fetch,
    budgetMs = DEFAULT_BUDGET_MS,
    maxSingleCalls = MAX_SINGLE_CALLS,
    singleBudgetMs = DEFAULT_SINGLE_BUDGET_MS,
    now = Date.now,
    base,
    onlyPairsInvolving: only,
  } = options;
  const deadline = now() + budgetMs;
  const n = points.length;

  const grid = <T>(fill: T) => Array.from({ length: n }, () => new Array<T>(n).fill(fill));
  const minutes = grid(0);
  const km = grid(0);
  const resolved = grid(false);
  const codes = grid<number | null>(null);
  const stats = { multiCalls: 0, singleCalls: 0, estimatedPairs: 0 };

  // 같은 곳(또는 자기 자신)은 호출하지 않고 0으로 둔다
  const askable = (a: number, b: number) => a !== b && straightDistanceKm(points[a], points[b]) > SAME_PLACE_KM;
  const involves = (a: number, b: number) => !only || only.has(a) || only.has(b);
  const mustAsk = (a: number, b: number) => askable(a, b) && involves(a, b);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (base && !involves(a, b)) {
        // 다시 조회하지 않는 구간은 이전 시간표 값을 그대로 쓴다 (이전에 추정값이던 구간은 그대로 추정값)
        minutes[a][b] = base.minutes[a][b];
        km[a][b] = base.km[a][b];
        codes[a][b] = base.codes[a][b];
        resolved[a][b] = !base.estimated[a][b];
      } else if (!askable(a, b)) {
        resolved[a][b] = true;
      }
    }
  }

  // 1) 지점마다 다중 목적지 길찾기 (한 번에 30곳까지)
  const outOfRadius = new Map<string, [number, number]>(); // 반경 밖이라 단건으로 보완할 쌍 (a<b로 한 번만)
  const origins = Array.from({ length: n }, (_, i) => i);
  await runPool(origins, NAVI_CONCURRENCY, async (a) => {
    const dests = origins.filter((b) => mustAsk(a, b));
    for (let start = 0; start < dests.length; start += MAX_DESTINATIONS) {
      const chunk = dests.slice(start, start + MAX_DESTINATIONS);
      stats.multiCalls++;
      const result = await fetchMulti(points[a], chunk.map((b) => ({ key: String(b), coord: points[b] })), restKey, fetchImpl);
      for (const b of chunk) {
        const r = result.get(String(b));
        if (r?.ok) {
          minutes[a][b] = r.minutes;
          km[a][b] = r.km;
          resolved[a][b] = true;
          codes[a][b] = 0;
        } else {
          codes[a][b] = r ? r.code : null;
          if (r && !r.ok && r.code === OUT_OF_RADIUS_CODE) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            outOfRadius.set(`${lo}-${hi}`, [lo, hi]);
          }
        }
      }
    }
  });

  // 2) 반경 밖 구간은 단건 길찾기로 보완 (호출 수·시간 예산 안에서만, 오가는 시간은 같다고 본다).
  //    출발지와 이어지는 구간을 가장 먼저 조회한다: "도로가 없는 필지(코드 103)"인지는 출발지에서 가는 구간으로 알 수 있어서,
  //    시간이 모자랄 때 이 구간이 빠지면 도로에서 먼 필지를 놓치게 된다. 나머지는 가까운 쌍부터.
  const pending = [...outOfRadius.values()].sort(
    (p, q) =>
      Number(p[0] !== 0) - Number(q[0] !== 0) ||
      straightDistanceKm(points[p[0]], points[p[1]]) - straightDistanceKm(points[q[0]], points[q[1]]),
  );
  const toAsk = pending.slice(0, maxSingleCalls);
  const singleDeadline = Math.min(deadline, now() + singleBudgetMs); // 이 단계는 전체 예산보다 짧게 쓴다
  await runPool(toAsk, NAVI_CONCURRENCY, async ([a, b]) => {
    if (now() >= singleDeadline) return;
    stats.singleCalls++;
    const r = await fetchSingle(points[a], points[b], restKey, fetchImpl);
    if (r.ok) {
      for (const [x, y] of [[a, b], [b, a]]) {
        minutes[x][y] = r.minutes;
        km[x][y] = r.km;
        resolved[x][y] = true;
        codes[x][y] = 0;
      }
    } else if (r.code !== null) {
      codes[a][b] = r.code;
      codes[b][a] = r.code;
    }
  });

  // 3) 아직 못 구한 구간은 직선거리 기반 추정값으로 채운다
  const fallback = buildFallbackMatrix(points, "car");
  const estimated = grid(false);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (resolved[a][b]) continue;
      minutes[a][b] = round2(fallback.minutes[a][b]);
      km[a][b] = round2(fallback.km[a][b]);
      estimated[a][b] = true;
      stats.estimatedPairs++;
    }
  }

  return { minutes, km, estimated, codes, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// 차량 접근이 어려운 필지 (Design Ref: §4.3, PRD 5장 must 2)
//
// 카카오 길찾기는 도착점을 가까운 도로로 옮겨서 계산한다(약 500m까지). 그보다 도로에서 멀면
// 결과 코드 103("도착 지점 주변의 도로를 탐색할 수 없음")이 돌아오고, 응답의 도착점은 항상 요청한 좌표
// 그대로라서 도로 끝이 어디인지 알려 주지 않는다. 그래서
//  1) 코드 103인 필지는 주변을 고리 모양으로 살펴 가장 가까운 도로 지점을 직접 찾고,
//  2) 순서가 정해진 뒤에는 구간별 경로 전체 응답의 마지막 좌표(= 도로 끝)와 필지의 거리를 잰다.
// ─────────────────────────────────────────────────────────────────────────────

/** 도로 끝 찾기를 시도하는 최대 필지 수 (호출이 많아지지 않도록) */
export const MAX_ROAD_END_SEARCHES = 6;
/** 도로 끝 찾기를 동시에 진행하는 필지 수 */
export const ROAD_END_SEARCH_CONCURRENCY = 3;
/** "도착 지점 주변의 도로를 탐색할 수 없음" */
export const NO_ROAD_CODE = 103;

export type RouteEnd =
  /** 길찾기 성공: 시간·거리와, 경로가 실제로 끝나는 도로 위 지점 */
  | { ok: true; minutes: number; km: number; end: Coord }
  | { ok: false; code: number | null };

type FullRoute = {
  result_code?: number;
  summary?: { distance?: number; duration?: number };
  sections?: { roads?: { vertexes?: number[] }[] }[];
};

/** 경로 전체 응답의 마지막 좌표 = 차로 갈 수 있는 도로 끝 */
function lastVertex(route: FullRoute): Coord | null {
  const sections = route.sections ?? [];
  for (let s = sections.length - 1; s >= 0; s--) {
    const roads = sections[s].roads ?? [];
    for (let r = roads.length - 1; r >= 0; r--) {
      const v = roads[r].vertexes;
      if (v && v.length >= 2 && Number.isFinite(v[v.length - 1]) && Number.isFinite(v[v.length - 2])) {
        return { lng: v[v.length - 2], lat: v[v.length - 1] };
      }
    }
  }
  return null;
}

/** 두 지점 사이의 자차 길찾기(경로 전체)로 시간·거리와 도로 끝 좌표를 가져온다. */
export async function fetchRouteEnd(
  from: Coord,
  to: Coord,
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteEnd> {
  const url = `${SINGLE_URL}?${new URLSearchParams({
    origin: `${from.lng},${from.lat}`,
    destination: `${to.lng},${to.lat}`,
    priority: "TIME",
  })}`;

  let res: Response;
  try {
    res = await fetchImpl(url, { headers: headers(restKey), signal: AbortSignal.timeout(CALL_TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, code: null };
  }
  if (res.status === 401 || res.status === 403) throw new KakaoAuthError();
  if (!res.ok) return { ok: false, code: null };

  let route: FullRoute | undefined;
  try {
    route = ((await res.json()) as { routes?: FullRoute[] }).routes?.[0];
  } catch {
    return { ok: false, code: null };
  }
  const duration = route?.summary?.duration;
  const distance = route?.summary?.distance;
  const end = route ? lastVertex(route) : null;
  if (route?.result_code === 0 && Number.isFinite(duration) && Number.isFinite(distance) && end) {
    return { ok: true, minutes: round2((duration as number) / 60), km: round2((distance as number) / 1000), end };
  }
  return { ok: false, code: typeof route?.result_code === "number" ? route.result_code : null };
}

/**
 * 도로에서 너무 먼 필지의 가장 가까운 도로 지점을 찾는다. 필지 주변을 가까운 고리부터 차례로 살피고,
 * 길찾기가 되는 지점이 나오면 그 고리에서 멈춘다. 찾은 도로 끝(end)과 필지까지의 거리(meters)를 돌려준다.
 * 어느 고리에서도 못 찾으면 null.
 */
export async function findRoadEnd(
  origin: Coord,
  target: Coord,
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ end: Coord; meters: number } | null> {
  for (const ringMeters of PROBE_RINGS_M) {
    const probes = probeRing(target, ringMeters);
    const results = await Promise.all(probes.map((p) => fetchRouteEnd(origin, p, restKey, fetchImpl)));
    let best: { end: Coord; meters: number } | null = null;
    for (const r of results) {
      if (!r.ok) continue;
      const meters = distanceMeters(target, r.end);
      if (!best || meters < best.meters) best = { end: r.end, meters };
    }
    if (best) return { end: best.end, meters: Math.round(best.meters) };
  }
  return null;
}

export type RoadEndInfo = { index: number; lat: number; lng: number; meters: number };

export type CarMatrixResult = CarMatrix & {
  /** 도로에서 멀어서 가까운 도로 지점으로 옮겨 계산한 필지 (지점 번호, 도로 끝 좌표, 필지까지 거리) */
  roadEnds: RoadEndInfo[];
  /** 가까운 도로를 찾지 못한 필지 (지점 번호). 이 필지의 구간은 추정값이다. */
  noRoad: number[];
};

/**
 * buildCarMatrix에 "도로에서 먼 필지" 처리를 더한 시간표.
 * 출발지에서 코드 103이 나온 필지는 가까운 도로 지점을 찾아 그 지점으로 바꿔 시간표를 다시 만든다.
 */
export async function buildCarMatrixWithRoadEnds(
  points: readonly Coord[],
  restKey: string,
  options: Parameters<typeof buildCarMatrix>[2] = {},
): Promise<CarMatrixResult> {
  const first = await buildCarMatrix(points, restKey, options);
  const noRoadIndexes: number[] = [];
  for (let j = 1; j < points.length; j++) if (first.codes[0][j] === NO_ROAD_CODE) noRoadIndexes.push(j);
  if (noRoadIndexes.length === 0) return { ...first, roadEnds: [], noRoad: [] };

  // 필지마다 독립적으로 찾으므로 동시에 처리한다 (한 번에 3필지까지: 요청이 한꺼번에 몰리지 않게)
  const found: RoadEndInfo[] = [];
  const searchable = noRoadIndexes.slice(0, MAX_ROAD_END_SEARCHES);
  await runPool(searchable, ROAD_END_SEARCH_CONCURRENCY, async (j) => {
    const r = await findRoadEnd(points[0], points[j], restKey, options.fetchImpl ?? fetch);
    if (r) found.push({ index: j, lat: r.end.lat, lng: r.end.lng, meters: r.meters });
  });
  found.sort((a, b) => a.index - b.index);
  const noRoad = noRoadIndexes.filter((j) => !found.some((f) => f.index === j));
  if (found.length === 0) return { ...first, roadEnds: [], noRoad };

  const moved = points.map((p, i) => {
    const f = found.find((x) => x.index === i);
    return f ? { lat: f.lat, lng: f.lng } : p;
  });
  // 옮긴 필지와 관련된 구간만 다시 계산한다 (나머지 구간은 첫 시간표 그대로)
  const second = await buildCarMatrix(moved, restKey, {
    ...options,
    base: first,
    onlyPairsInvolving: new Set(found.map((f) => f.index)),
  });
  return { ...second, roadEnds: found, noRoad };
}

export type CarLegResult =
  /** endGapMeters: 구간의 도착점(필지)과 길찾기가 실제로 끝나는 도로 끝 사이의 거리(미터) */
  | { ok: true; minutes: number; km: number; endGapMeters: number }
  | { ok: false; status: number | null };

/**
 * 지점 목록을 순서대로 이은 구간들(points[i] → points[i+1])의 자차 시간·거리와, 도착점의 도로 끝까지 거리를 구한다.
 * 결과는 구간 순서와 같다. 시간 예산이 지나면 남은 구간은 조회하지 않는다.
 * 인증 문제(키·서비스 설정)는 KakaoAuthError로 던진다.
 */
export async function fetchCarLegs(
  points: readonly Coord[],
  restKey: string,
  options: { fetchImpl?: typeof fetch; budgetMs?: number; now?: () => number } = {},
): Promise<CarLegResult[]> {
  const { fetchImpl = fetch, budgetMs = DEFAULT_BUDGET_MS, now = Date.now } = options;
  const deadline = now() + budgetMs;
  const results: CarLegResult[] = Array.from({ length: Math.max(points.length - 1, 0) }, () => ({ ok: false, status: null }));

  await runPool(results.map((_, i) => i), NAVI_CONCURRENCY, async (i) => {
    if (now() >= deadline) return;
    const r = await fetchRouteEnd(points[i], points[i + 1], restKey, fetchImpl);
    results[i] = r.ok
      ? { ok: true, minutes: r.minutes, km: r.km, endGapMeters: Math.round(distanceMeters(points[i + 1], r.end)) }
      : { ok: false, status: r.code };
  });
  return results;
}
