// Design Ref: §4.4 순서 계산 엔진 — 구간 시간표만 넣으면 가장 짧은 방문 순서를 구한다 (화면·서버와 무관한 순수 계산)
// Plan SC: PRD 5장 must 2 — 모든 필지를 정확히 1번씩 방문, 출발지에서 시작, 복귀/마지막 필지 종료 반영
//
// 지점 번호: 0 = 출발지, 1..n = 필지. matrix[a][b] = a에서 b까지 걸리는 시간(분). 오고 가는 시간이 달라도 된다.

export type EndMode = "return" | "lastParcel";
export type Matrix = readonly (readonly number[])[];

/** 이 개수 이하의 필지는 최단 순서를 정확히 구한다 (Held-Karp 동적 계획법) */
export const EXACT_LIMIT = 12;
const DEFAULT_TIME_LIMIT_MS = 1500;
const EPS = 1e-9;

/** 출발지에서 order(필지 번호 순서)대로 돌 때의 총 이동 시간. 복귀 설정이면 출발지로 돌아오는 시간까지 더한다. */
export function pathCost(order: readonly number[], m: Matrix, endMode: EndMode): number {
  if (order.length === 0) return 0;
  let cost = m[0][order[0]];
  for (let i = 1; i < order.length; i++) cost += m[order[i - 1]][order[i]];
  if (endMode === "return") cost += m[order[order.length - 1]][0];
  return cost;
}

/** 필지 12개 이하: 가능한 모든 순서 중 가장 짧은 순서를 정확히 구한다. */
export function solveExact(m: Matrix, endMode: EndMode): number[] {
  const n = m.length - 1;
  if (n <= 0) return [];
  if (n === 1) return [1];

  const full = (1 << n) - 1;
  const dp = new Float64Array((full + 1) * n).fill(Infinity);
  const parent = new Int8Array((full + 1) * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = m[0][j + 1];

  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * n + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const cost = cur + m[j + 1][k + 1];
        if (cost < dp[next * n + k]) {
          dp[next * n + k] = cost;
          parent[next * n + k] = j;
        }
      }
    }
  }

  let bestLast = 0;
  let bestCost = Infinity;
  for (let j = 0; j < n; j++) {
    const cost = dp[full * n + j] + (endMode === "return" ? m[j + 1][0] : 0);
    if (cost < bestCost) {
      bestCost = cost;
      bestLast = j;
    }
  }

  const order: number[] = [];
  let mask = full;
  let j = bestLast;
  while (j >= 0) {
    order.push(j + 1);
    const prev = parent[mask * n + j];
    mask ^= 1 << j;
    j = prev;
  }
  return order.reverse();
}

/** 출발지에서 출발해 가장 가까운 곳부터 잇는다. firstRank번째로 가까운 곳을 첫 방문지로 삼아 여러 시작점을 만든다. */
function nearestNeighbor(m: Matrix, n: number, firstRank: number): number[] {
  const remaining = new Set<number>();
  for (let i = 1; i <= n; i++) remaining.add(i);

  const byDistance = [...remaining].sort((a, b) => m[0][a] - m[0][b] || a - b);
  const order: number[] = [byDistance[Math.min(firstRank, n - 1)]];
  remaining.delete(order[0]);

  while (remaining.size > 0) {
    const from = order[order.length - 1];
    let best = -1;
    for (const candidate of remaining) {
      if (best === -1 || m[from][candidate] < m[from][best] - EPS || (Math.abs(m[from][candidate] - m[from][best]) <= EPS && candidate < best)) {
        best = candidate;
      }
    }
    order.push(best);
    remaining.delete(best);
  }
  return order;
}

/** 구간 뒤집기(2-opt)와 구간 옮기기(Or-opt)를 더 줄어들지 않을 때까지(또는 시간이 다 될 때까지) 반복한다. */
function improve(start: number[], m: Matrix, endMode: EndMode, deadline: number): number[] {
  let best = start.slice();
  let bestCost = pathCost(best, m, endMode);
  const n = best.length;

  let improved = true;
  while (improved && performance.now() < deadline) {
    improved = false;

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const cost = pathCost(candidate, m, endMode);
        if (cost < bestCost - EPS) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
      if (performance.now() >= deadline) return best;
    }

    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= n; i++) {
        const segment = best.slice(i, i + len);
        const rest = best.slice(0, i).concat(best.slice(i + len));
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          const candidate = rest.slice(0, k).concat(segment, rest.slice(k));
          const cost = pathCost(candidate, m, endMode);
          if (cost < bestCost - EPS) {
            best = candidate;
            bestCost = cost;
            improved = true;
            break;
          }
        }
      }
      if (performance.now() >= deadline) return best;
    }
  }
  return best;
}

/** 필지 13~30개: 최단에 가까운 근사 순서 (최단 보장은 아님). 결과는 항상 같은 입력이면 같은 순서다. */
export function solveHeuristic(m: Matrix, endMode: EndMode, timeLimitMs: number = DEFAULT_TIME_LIMIT_MS): number[] {
  const n = m.length - 1;
  if (n <= 0) return [];
  if (n === 1) return [1];

  const deadline = performance.now() + timeLimitMs;
  let best: number[] = [];
  let bestCost = Infinity;
  const starts = Math.min(n, 8);

  for (let rank = 0; rank < starts; rank++) {
    const order = improve(nearestNeighbor(m, n, rank), m, endMode, deadline);
    const cost = pathCost(order, m, endMode);
    if (cost < bestCost - EPS) {
      best = order;
      bestCost = cost;
    }
    if (performance.now() >= deadline) break;
  }
  return best;
}

export type SolveResult = {
  /** 방문할 필지 번호(1..n)를 방문 순서대로 */
  order: number[];
  /** true면 최단 순서가 보장됨, false면 근사 순서 */
  exact: boolean;
  /** 이동 시간만의 합(분, 조사 시간 제외) */
  travelCost: number;
};

/** 필지 수에 따라 정확한 계산 또는 근사 계산으로 가장 짧은 방문 순서를 구한다. */
export function solveOrder(m: Matrix, endMode: EndMode, timeLimitMs?: number): SolveResult {
  const n = m.length - 1;
  const exact = n <= EXACT_LIMIT;
  const order = exact ? solveExact(m, endMode) : solveHeuristic(m, endMode, timeLimitMs);
  return { order, exact, travelCost: pathCost(order, m, endMode) };
}
