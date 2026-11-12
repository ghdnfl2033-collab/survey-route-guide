// Design Ref: §4.1 ⑦ — 순서가 정해진 지점들의 구간별 실제 값을 서버(/api/route-legs)에서 받는다. 좌표만 보낸다.

import type { LegActual } from "@/lib/core/route";
import type { Coord, Ride } from "@/lib/core/types";

export class RouteLegsError extends Error {
  /** 접속 코드가 만료되어 다시 입장해야 하는 경우 */
  readonly unauthorized: boolean;
  constructor(message: string, unauthorized = false) {
    super(message);
    this.name = "RouteLegsError";
    this.unauthorized = unauthorized;
  }
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function toRides(value: unknown): Ride[] {
  if (!Array.isArray(value)) return [];
  const rides: Ride[] = [];
  for (const r of value) {
    if (typeof r !== "object" || r === null || typeof (r as { name?: unknown }).name !== "string") continue;
    const { name, from, to, stops } = r as { name: string; from?: unknown; to?: unknown; stops?: unknown };
    rides.push({
      name,
      ...(typeof from === "string" ? { from } : {}),
      ...(typeof to === "string" ? { to } : {}),
      ...(isNumber(stops) ? { stops } : {}),
    });
  }
  return rides;
}

function toActual(value: unknown): LegActual | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { ok?: unknown; minutes?: unknown; km?: unknown; transfers?: unknown; lines?: unknown; rides?: unknown; walk?: unknown; endGapMeters?: unknown };
  if (v.ok === false) return { ok: false };
  if (v.ok === true && isNumber(v.minutes) && isNumber(v.km)) {
    return {
      ok: true,
      minutes: v.minutes,
      km: v.km,
      ...(isNumber(v.transfers) ? { transfers: v.transfers } : {}),
      ...(toRides(v.rides).length > 0 ? { rides: toRides(v.rides) } : {}),
      ...(Array.isArray(v.lines) && v.lines.length > 0 && v.lines.every((l) => typeof l === "string") ? { lines: v.lines as string[] } : {}),
      ...(v.walk === true ? { walkFallback: true } : {}),
      ...(isNumber(v.endGapMeters) ? { endGapMeters: v.endGapMeters } : {}),
    };
  }
  return null;
}

async function fetchLegs(points: readonly Coord[], mode: "walk" | "transit" | "car", fetchImpl: typeof fetch): Promise<LegActual[]> {
  let res: Response;
  try {
    res = await fetchImpl("/api/route-legs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, mode }),
    });
  } catch {
    throw new RouteLegsError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
  }

  if (res.status === 401) throw new RouteLegsError("접속 시간이 지났어요. 다시 입장해 주세요.", true);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new RouteLegsError(body?.error?.message ?? "길찾기 중 문제가 생겼어요.");

  const legs = body?.legs;
  if (!Array.isArray(legs) || legs.length !== points.length - 1) {
    throw new RouteLegsError("서버 응답이 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.");
  }
  const actuals = legs.map(toActual);
  if (actuals.some((a) => a === null)) throw new RouteLegsError("서버 응답이 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.");
  return actuals as LegActual[];
}

/** points[i] → points[i+1] 구간마다 걷는 시간·거리를 받아 온다 (도보). 실패하면 RouteLegsError. */
export const fetchWalkLegs = (points: readonly Coord[], fetchImpl: typeof fetch = fetch) => fetchLegs(points, "walk", fetchImpl);

/** points[i] → points[i+1] 구간마다 자차 시간·거리와, 도착점에서 도로 끝까지의 거리(endGapMeters)를 받아 온다. */
export const fetchCarLegs = (points: readonly Coord[], fetchImpl: typeof fetch = fetch) => fetchLegs(points, "car", fetchImpl);

/** points[i] → points[i+1] 구간마다 대중교통 시간·거리·환승 횟수를 받아 온다. 경로가 없는 구간은 도보 구간(walkFallback)으로 온다. */
export const fetchTransitLegs = (points: readonly Coord[], fetchImpl: typeof fetch = fetch) => fetchLegs(points, "transit", fetchImpl);
