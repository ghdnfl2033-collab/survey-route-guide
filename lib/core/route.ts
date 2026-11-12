// Design Ref: §4.1 ⑥ — 선택한 필지와 설정으로 동선(방문 순서·구간·시간)을 만든다 (순수 계산)
// Plan SC: PRD 5장 must 2 — 모든 필지 정확히 1번, 출발지 시작, 조사 시간 포함, 표에 순번·다음까지 거리·시간

import { buildFallbackMatrix } from "./fallback";
import { needsRoadEndWalk } from "./roadEnd";
import { solveOrder } from "./tsp";
import type { Coord, Leg, Parcel, Ride, RouteSettings } from "./types";

/** 지점 사이의 구간 시간표 (0번 = 출발지, 1..n = 필지). 길찾기 서비스 결과이거나 직선거리 추정값이다. */
export type Timetable = {
  minutes: number[][];
  km: number[][];
  /** true면 길찾기 결과가 아니라 직선거리로 추정한 구간 ("추정값" 표시 대상) */
  estimated: boolean[][];
  /**
   * 자차: 도로에서 멀어서 가까운 도로 지점으로 옮겨 계산한 필지 (지점 번호, 도로 끝 좌표, 필지까지의 거리 m).
   * 이 필지로 가는 구간에는 "도로 끝에서 도보 이동 필요"를 표시한다.
   */
  roadEnds?: { index: number; coord: Coord; meters: number }[];
  /** 자차: 가까운 도로를 찾지 못한 필지 (지점 번호). 구간은 추정값이고 "도로 끝에서 도보 이동 필요"를 함께 표시한다. */
  noRoad?: number[];
};

/** 시간표를 만들 때 쓰는 지점 목록: 출발지, 그다음 위치가 있는 필지(들어온 순서대로). planRoute의 지점 번호와 같다. */
export function routePoints(settings: RouteSettings, parcels: readonly Parcel[]): Coord[] {
  return [settings.origin.coord, ...parcels.flatMap((p) => (p.coord ? [p.coord] : []))];
}

export type RoutePlan = {
  /** 방문 순서대로 나열한 필지 id */
  orderIds: string[];
  /** legs[0] = 출발지→첫 필지, legs[i] = i번째 필지→다음 필지, (복귀 설정이면) 마지막 = 마지막 필지→출발지 */
  legs: Leg[];
  /** 각 필지에 도착하는 시각 (하루 0시부터의 분, 24시간을 넘으면 1440 이상) — orderIds와 같은 순서 */
  arrivalMinutes: number[];
  /** 출발지로 돌아오는 시각 (복귀 설정일 때만) */
  returnMinutes?: number;
  departMinutes: number;
  travelMinutes: number;
  inspectMinutes: number;
  totalMinutes: number;
  /** 직선거리 추정 구간이 하나라도 있는지 ("추정값" 표시 대상) */
  estimated: boolean;
  /** 직선거리로 추정한 구간 수 (전체 구간 수는 legs.length) */
  estimatedLegCount: number;
  /** true면 최단 순서가 보장됨, false면 근사 순서 (필지 13개 이상) */
  exact: boolean;
  /** true면 사용자가 순서를 직접 바꾼 계획 (최단 순서가 아닐 수 있다) */
  manual?: boolean;
};

/** "09:30" → 570 */
export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 570 → "09:30", 24시간을 넘으면 "다음날 01:10" */
export function formatClock(totalMinutes: number): string {
  const day = Math.floor(totalMinutes / 1440);
  const inDay = totalMinutes - day * 1440;
  const hh = String(Math.floor(inDay / 60)).padStart(2, "0");
  const mm = String(Math.round(inDay % 60)).padStart(2, "0");
  return `${day > 0 ? (day === 1 ? "다음날 " : `${day}일 뒤 `) : ""}${hh}:${mm}`;
}

/** 분을 "2시간 5분" 형태로 */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/**
 * 동선을 만든다. 위치(coord)가 없는 필지는 제외한다.
 * timetable(길찾기 서비스 결과 등)을 주면 그 시간표로, 주지 않으면 직선거리 기반 추정 시간표로 계산한다.
 * 시간표의 지점 번호는 routePoints(settings, parcels)와 같아야 하며, 크기가 다르면 추정 시간표를 쓴다.
 */
export function planRoute(settings: RouteSettings, parcels: readonly Parcel[], timetable?: Timetable): RoutePlan {
  const located = parcels.filter((p): p is Parcel & { coord: NonNullable<Parcel["coord"]> } => !!p.coord);
  const points = routePoints(settings, parcels);

  const given = timetable && timetable.minutes.length === points.length ? timetable : null;
  const fallback = given ? null : buildFallbackMatrix(points, settings.mode);
  const minutesMatrix = given ? given.minutes : (fallback as { minutes: number[][] }).minutes;
  const km = given ? given.km : (fallback as { km: number[][] }).km;
  const isEstimated = (a: number, b: number) => (given ? given.estimated[a][b] : true);
  const roadEndMetersOf = new Map((given?.roadEnds ?? []).map((r) => [r.index, r.meters]));
  const noRoad = new Set(given?.noRoad ?? []);

  const { order, exact } = solveOrder(minutesMatrix, settings.endMode);

  // 방문 순서대로 지점 번호를 늘어놓고 구간(Leg)을 만든다
  const nodes = [0, ...order, ...(settings.endMode === "return" && order.length > 0 ? [0] : [])];
  const idOf = (node: number) => (node === 0 ? "origin" : located[node - 1].id);
  const legs: Leg[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const [a, b] = [nodes[i], nodes[i + 1]];
    legs.push({
      from: idOf(a),
      to: idOf(b),
      distanceKm: Math.round(km[a][b] * 10) / 10,
      minutes: Math.round(minutesMatrix[a][b]),
      estimated: isEstimated(a, b),
      walkFallback: false,
      // 도착지가 도로에서 먼 필지면 "도로 끝에서 도보 이동 필요" (출발지로 돌아오는 구간은 해당 없음)
      roadEndWalk: b !== 0 && (roadEndMetersOf.has(b) || noRoad.has(b)),
      ...(b !== 0 && roadEndMetersOf.has(b) ? { roadEndMeters: roadEndMetersOf.get(b) } : {}),
    });
  }

  return assemblePlan(
    settings,
    order.map((node) => located[node - 1].id),
    legs,
    exact,
  );
}

/** 방문 순서와 구간으로 시각·합계를 계산해 동선 계획을 완성한다. 출발 → (이동) → 도착 → (조사) → 출발 → … */
function assemblePlan(settings: RouteSettings, orderIds: string[], legs: Leg[], exact: boolean, manual = false): RoutePlan {
  const departMinutes = parseClock(settings.departTime);
  const arrivalMinutes: number[] = [];
  let clock = departMinutes;
  orderIds.forEach((_, i) => {
    clock += legs[i].minutes;
    arrivalMinutes.push(clock);
    clock += settings.inspectMinutes;
  });
  const hasReturnLeg = settings.endMode === "return" && orderIds.length > 0;
  const returnMinutes = hasReturnLeg ? clock + legs[legs.length - 1].minutes : undefined;

  const travelMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const inspectMinutes = settings.inspectMinutes * orderIds.length;

  return {
    orderIds,
    legs,
    arrivalMinutes,
    returnMinutes,
    departMinutes,
    travelMinutes,
    inspectMinutes,
    totalMinutes: travelMinutes + inspectMinutes,
    estimated: legs.some((l) => l.estimated),
    estimatedLegCount: legs.filter((l) => l.estimated).length,
    exact,
    ...(manual ? { manual: true } : {}),
  };
}

/**
 * 시간표에서 도로 끝으로 옮겨 계산한 필지의 좌표를 필지 id별로 모은다 (자차).
 * 구간을 다시 조회할 때 필지 좌표 대신 이 도로 끝 좌표를 써야 같은 길로 계산된다.
 */
export function roadEndOverrides(settings: RouteSettings, parcels: readonly Parcel[], timetable: Timetable | undefined): Map<string, Coord> {
  const located = routePoints(settings, parcels).slice(1);
  const ids = parcels.filter((p) => p.coord).map((p) => p.id);
  const out = new Map<string, Coord>();
  for (const r of timetable?.roadEnds ?? []) {
    const id = ids[r.index - 1];
    if (id !== undefined && located[r.index - 1]) out.set(id, r.coord);
  }
  return out;
}

/**
 * 계획의 구간들을 이은 지점 좌표 목록: [출발지, 첫 필지, …] — 구간 i는 points[i] → points[i+1]. 실제 구간 값을 조회할 때 쓴다.
 * overrides가 있으면 그 필지는 필지 좌표 대신 주어진 좌표(도로 끝)를 쓴다.
 */
export function legPoints(
  settings: RouteSettings,
  plan: RoutePlan,
  parcels: readonly Parcel[],
  overrides: ReadonlyMap<string, Coord> = new Map(),
): Coord[] {
  const byId = new Map(parcels.map((p) => [p.id, overrides.get(p.id) ?? p.coord]));
  const coordOf = (id: string): Coord => (id === "origin" ? settings.origin.coord : (byId.get(id) as Coord));
  if (plan.legs.length === 0) return [];
  return [coordOf(plan.legs[0].from), ...plan.legs.map((l) => coordOf(l.to))];
}

/** 지도에 그릴 경로: 구간마다 선 하나(추정값 구간은 점선), 방문하는 필지의 순번(1부터) */
export type RouteDrawing = {
  segments: { from: Coord; to: Coord; estimated: boolean }[];
  /** 필지 id → 방문 순번 */
  order: Record<string, number>;
  /** 경로가 지나는 모든 지점 (지도를 맞출 범위) */
  points: Coord[];
};

/**
 * 동선 계획을 지도에 그릴 모양으로 바꾼다. 방문 순서대로 지점을 직선으로 잇는다
 * (실제 도로 경로가 아니라 순서를 보여 주는 선이다).
 */
export function routeDrawing(settings: RouteSettings, plan: RoutePlan, parcels: readonly Parcel[]): RouteDrawing {
  const points = legPoints(settings, plan, parcels);
  const segments = plan.legs.map((leg, i) => ({ from: points[i], to: points[i + 1], estimated: leg.estimated }));
  const order: Record<string, number> = {};
  plan.orderIds.forEach((id, i) => {
    order[id] = i + 1;
  });
  return { segments, order, points };
}

/**
 * 구간 하나의 실제 조회 결과 (성공하면 분·km, 못 구했으면 ok false).
 * 대중교통은 환승 횟수(transfers)와, 대중교통 경로가 없어 걷는 시간으로 대신한 "도보 구간"(walkFallback)을 함께 담는다.
 */
export type LegActual =
  | { ok: true; minutes: number; km: number; transfers?: number; lines?: string[]; rides?: Ride[]; walkFallback?: boolean; endGapMeters?: number }
  | { ok: false };

/**
 * 이미 정해진 방문 순서는 그대로 두고, 구간별 실제 값(길찾기 결과)으로 시간·거리·시각·합계를 다시 계산한다.
 * 실제 값을 얻은 구간은 "추정값"이 아니게 되고, 못 얻은 구간은 기존 값(추정)을 유지한다.
 * 결과 개수가 구간 수와 다르면 계획을 그대로 돌려준다.
 */
export function repricePlan(settings: RouteSettings, plan: RoutePlan, actuals: readonly LegActual[]): RoutePlan {
  if (actuals.length !== plan.legs.length) return plan;
  const legs = plan.legs.map((leg, i) => {
    const actual = actuals[i];
    if (!actual.ok) return leg;
    // 자차: 구간의 도착점과 길찾기가 끝난 도로 끝 사이가 멀면(100m 초과) 필지로 가려면 도로 끝에서 걸어야 한다.
    // 이미 시간표 단계에서 도로 끝으로 옮겨 계산한 필지(roadEndMeters)는 그 거리를 그대로 둔다.
    const gap = actual.endGapMeters;
    const walkFromRoadEnd = leg.to !== "origin" && leg.roadEndMeters === undefined && needsRoadEndWalk(gap);
    return {
      ...leg,
      minutes: Math.round(actual.minutes),
      distanceKm: Math.round(actual.km * 10) / 10,
      estimated: false,
      transfers: actual.transfers,
      lines: actual.lines,
      rides: actual.rides,
      walkFallback: actual.walkFallback ?? false,
      roadEndWalk: leg.roadEndWalk || walkFromRoadEnd,
      ...(walkFromRoadEnd ? { roadEndMeters: Math.round(gap as number) } : {}),
    };
  });
  return assemblePlan(settings, plan.orderIds, legs, plan.exact, plan.manual);
}

/** 순서 목록에서 from번째 항목을 to번째 자리로 옮긴다 (0부터). 범위를 벗어나면 그대로 돌려준다. */
export function moveInOrder(orderIds: readonly string[], from: number, to: number): string[] {
  const next = [...orderIds];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 방문 순서(orderIds)에 맞춰 동선 계획을 만든다. base 계획에 같은 구간(from→to)이 있으면 그 값(길찾기 결과)을 그대로 쓰고,
 * 없는 구간만 직선거리 추정값으로 채운다. 새로 만든 구간의 번호(freshLegIndexes)를 함께 돌려준다.
 * 도로 끝에서 걸어야 하는 필지의 표시는 base 계획에서 이어받는다.
 */
function planFromOrder(
  settings: RouteSettings,
  base: RoutePlan,
  parcels: readonly Parcel[],
  orderIds: readonly string[],
  manual: boolean,
): { plan: RoutePlan; freshLegIndexes: number[] } {
  const coordOf = new Map(parcels.flatMap((p) => (p.coord ? [[p.id, p.coord] as const] : [])));
  const idsInRoute = ["origin", ...orderIds, ...(settings.endMode === "return" && orderIds.length > 0 ? ["origin"] : [])];
  const roadEndOf = new Map<string, Leg>();
  base.legs.forEach((l) => {
    if (l.to !== "origin" && l.roadEndWalk) roadEndOf.set(l.to, l);
  });

  const freshLegIndexes: number[] = [];
  const legs: Leg[] = [];
  for (let i = 0; i < idsInRoute.length - 1; i++) {
    const [from, to] = [idsInRoute[i], idsInRoute[i + 1]];
    const kept = base.legs.find((l) => l.from === from && l.to === to);
    if (kept) {
      legs.push(kept);
      continue;
    }
    const a = from === "origin" ? settings.origin.coord : (coordOf.get(from) as Coord);
    const b = to === "origin" ? settings.origin.coord : (coordOf.get(to) as Coord);
    const m = buildFallbackMatrix([a, b], settings.mode);
    const road = to !== "origin" ? roadEndOf.get(to) : undefined;
    legs.push({
      from,
      to,
      distanceKm: Math.round(m.km[0][1] * 10) / 10,
      minutes: Math.round(m.minutes[0][1]),
      estimated: true,
      walkFallback: false,
      roadEndWalk: !!road,
      ...(road?.roadEndMeters !== undefined ? { roadEndMeters: road.roadEndMeters } : {}),
    });
    freshLegIndexes.push(i);
  }
  return { plan: assemblePlan(settings, [...orderIds], legs, false, manual), freshLegIndexes };
}

/**
 * 사용자가 바꾼 방문 순서(newOrderIds)로 동선을 다시 만든다.
 * 앞뒤 필지가 그대로인 구간은 기존 값(길찾기 결과)을 그대로 쓰고, 새로 생긴 구간만 직선거리 추정값으로 채운다.
 * 새로 생긴 구간의 번호(freshLegIndexes)를 함께 돌려주므로, 호출하는 쪽에서 그 구간만 길찾기로 다시 확인해 repricePlan에 넘긴다.
 * newOrderIds가 기존 필지를 정확히 한 번씩 담고 있지 않으면 계획을 바꾸지 않는다.
 */
export function reorderPlan(
  settings: RouteSettings,
  plan: RoutePlan,
  parcels: readonly Parcel[],
  newOrderIds: readonly string[],
): { plan: RoutePlan; freshLegIndexes: number[] } {
  const same =
    newOrderIds.length === plan.orderIds.length &&
    new Set(newOrderIds).size === newOrderIds.length &&
    plan.orderIds.every((id) => newOrderIds.includes(id));
  if (!same) return { plan, freshLegIndexes: [] };
  if (newOrderIds.every((id, i) => id === plan.orderIds[i])) return { plan, freshLegIndexes: [] };
  return planFromOrder(settings, plan, parcels, newOrderIds, true);
}

/** 하루에 조사할 수 있는 필지 수 (PRD: 여러 날로 나누기는 하루 18필지씩) */
export const PARCELS_PER_DAY = 18;

export type DayPlan = { plan: RoutePlan; freshLegIndexes: number[] };

/**
 * 전체 동선을 하루 perDay곳씩 나눈다. 전체 최단 순서를 앞에서부터 그대로 끊으므로 필지 순서는 바뀌지 않는다.
 * 하루마다 출발지에서 시작하고(복귀 설정이면 출발지로 돌아오고), 끊는 자리에서 새로 생기는 구간(출발지↔그날 첫·끝 필지)만
 * 추정값으로 채운다. 번호(freshLegIndexes)의 구간을 길찾기로 다시 확인해 repricePlan에 넘기면 된다.
 * 필지가 perDay 이하이면 하루짜리 한 개를 돌려준다.
 */
export function splitPlanByDay(
  settings: RouteSettings,
  plan: RoutePlan,
  parcels: readonly Parcel[],
  perDay: number = PARCELS_PER_DAY,
): DayPlan[] {
  const size = Math.max(1, Math.floor(perDay));
  const days: DayPlan[] = [];
  for (let i = 0; i < plan.orderIds.length; i += size) {
    days.push(planFromOrder(settings, plan, parcels, plan.orderIds.slice(i, i + size), false));
  }
  return days;
}

/** "2026-11-13"에 일수를 더한 날짜 ("2026-11-14") */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
