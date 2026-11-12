// Design Ref: §4.3 도보 — 카카오맵 도보 경로 API로 지정한 구간의 걷는 시간·거리를 가져온다 (서버 전용)
// Plan SC: PRD 4장 — 도보는 걷는 거리가 가장 짧은 순서 / PRD 5장 — 길찾기 실패 시 직선거리 추정값으로 대신하고 표시
// 개인정보: 좌표만 보내고, 서버에 저장하거나 로그에 남기지 않는다.
//
// 이 API는 한 번에 한 구간만 조회한다 (묶음 조회 없음, 하루 무료 1,000건).
// 그래서 모든 쌍을 조회하지 않고, 순서가 정해진 뒤 그 순서의 구간(최대 31개)만 조회한다.

import type { Coord } from "@/lib/core/types";
import { KakaoAuthError } from "./kakao";

const WALK_URL = "https://dapi.kakao.com/v2/routing/walk";
const CALL_TIMEOUT_MS = 4000;
export const WALK_CONCURRENCY = 5;
/** 구간 조회 전체에 쓸 수 있는 시간(밀리초). 지나면 남은 구간은 조회하지 않고 추정값으로 남긴다. */
export const WALK_BUDGET_MS = 8000;
/** 한 번에 조회할 수 있는 최대 구간 수: 출발지 → 필지 30개 → 출발지 */
export const MAX_WALK_LEGS = 31;

export type WalkLegResult =
  /** 길찾기로 구한 값 */
  | { ok: true; minutes: number; km: number }
  /** 못 구한 이유: 카카오 상태값(TOO_FAR_AWAY 등), 호출 실패나 미조회는 null */
  | { ok: false; status: string | null };

const round2 = (v: number) => Math.round(v * 100) / 100;

type WalkResponse = { status?: string; route?: { properties?: { totalDistance?: number; totalTime?: number } } };

/** 두 지점 사이의 걷는 시간·거리 한 구간 */
export async function fetchWalkLeg(
  from: Coord,
  to: Coord,
  restKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WalkLegResult> {
  const url = `${WALK_URL}?${new URLSearchParams({
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

  let body: WalkResponse;
  try {
    body = (await res.json()) as WalkResponse;
  } catch {
    return { ok: false, status: null };
  }

  if (body.status === "SAME_POINT") return { ok: true, minutes: 0, km: 0 };
  const seconds = body.route?.properties?.totalTime;
  const meters = body.route?.properties?.totalDistance;
  if (body.status === "OK" && Number.isFinite(seconds) && Number.isFinite(meters)) {
    return { ok: true, minutes: round2((seconds as number) / 60), km: round2((meters as number) / 1000) };
  }
  return { ok: false, status: typeof body.status === "string" ? body.status : null };
}

/**
 * 지점 목록을 순서대로 이은 구간들(points[i] → points[i+1])의 걷는 시간·거리를 구한다.
 * 결과는 구간 순서와 같다. 시간 예산이 지나면 남은 구간은 조회하지 않고 status null로 남긴다.
 * 인증 문제(키·서비스 설정)는 KakaoAuthError로 던진다.
 */
export async function fetchWalkLegs(
  points: readonly Coord[],
  restKey: string,
  options: { fetchImpl?: typeof fetch; budgetMs?: number; now?: () => number } = {},
): Promise<WalkLegResult[]> {
  const { fetchImpl = fetch, budgetMs = WALK_BUDGET_MS, now = Date.now } = options;
  const deadline = now() + budgetMs;
  const results: WalkLegResult[] = Array.from({ length: Math.max(points.length - 1, 0) }, () => ({ ok: false, status: null }));

  let next = 0;
  async function worker() {
    while (next < results.length) {
      const i = next++;
      if (now() >= deadline) continue;
      results[i] = await fetchWalkLeg(points[i], points[i + 1], restKey, fetchImpl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, results.length) }, worker));
  return results;
}
