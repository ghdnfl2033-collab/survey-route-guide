import { describe, expect, it } from "vitest";
import { EXACT_LIMIT, pathCost, solveExact, solveHeuristic, solveOrder, type EndMode, type Matrix } from "@/lib/core/tsp";

/** 항상 같은 값을 내는 난수 (점검 결과가 매번 같도록) */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const euclid = (pts: Pt[]): number[][] => pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));

function randomPoints(n: number, seed: number): Pt[] {
  const r = rng(seed);
  return Array.from({ length: n + 1 }, () => [r() * 100, r() * 100] as Pt);
}

/** 모든 순서를 일일이 따져 보는 느린 방법 (정답 확인용, 필지 7개 이하에서만 사용) */
function bruteForce(m: Matrix, endMode: EndMode): number {
  const n = m.length - 1;
  let best = Infinity;
  const used = new Array(n + 1).fill(false);
  const order: number[] = [];
  (function walk() {
    if (order.length === n) {
      best = Math.min(best, pathCost(order, m, endMode));
      return;
    }
    for (let i = 1; i <= n; i++) {
      if (used[i]) continue;
      used[i] = true;
      order.push(i);
      walk();
      order.pop();
      used[i] = false;
    }
  })();
  return best;
}

const isPermutation = (order: number[], n: number) =>
  order.length === n && new Set(order).size === n && order.every((v) => v >= 1 && v <= n);

describe("solveExact — 정확한 최단 순서 (필지 12개 이하)", () => {
  it("필지가 없으면 빈 순서, 하나면 그 필지", () => {
    expect(solveExact([[0]], "return")).toEqual([]);
    expect(solveExact(euclid([[0, 0], [5, 5]]), "return")).toEqual([1]);
  });

  it("무작위 배치에서 모든 순서를 따져 본 정답과 같다 (복귀·종료 둘 다)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const n = 3 + (seed % 5); // 3~7개
      const m = euclid(randomPoints(n, seed));
      for (const endMode of ["return", "lastParcel"] as const) {
        const order = solveExact(m, endMode);
        expect(isPermutation(order, n)).toBe(true);
        expect(pathCost(order, m, endMode)).toBeCloseTo(bruteForce(m, endMode), 6);
      }
    }
  });

  it("가는 시간과 오는 시간이 달라도(한 방향 도로 등) 정답과 같다", () => {
    const r = rng(77);
    const n = 6;
    const m = Array.from({ length: n + 1 }, (_, a) => Array.from({ length: n + 1 }, (_, b) => (a === b ? 0 : 1 + r() * 30)));
    for (const endMode of ["return", "lastParcel"] as const) {
      expect(pathCost(solveExact(m, endMode), m, endMode)).toBeCloseTo(bruteForce(m, endMode), 6);
    }
  });

  it("일직선 위에서는 가까운 순서대로 간다", () => {
    const m = euclid([[0, 0], [30, 0], [10, 0], [20, 0], [40, 0]]);
    expect(solveExact(m, "lastParcel")).toEqual([2, 3, 1, 4]);
  });

  it("12개를 넘어도 막히지 않을 만큼 빠르다 (12개 정확 계산)", () => {
    const m = euclid(randomPoints(EXACT_LIMIT, 5));
    const t = performance.now();
    const order = solveExact(m, "return");
    expect(isPermutation(order, EXACT_LIMIT)).toBe(true);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe("solveHeuristic — 근사 순서 (필지 13~30개)", () => {
  it("30개에서도 모든 필지를 정확히 한 번씩 방문하는 순서가 나온다", () => {
    for (const seed of [1, 2, 3]) {
      const m = euclid(randomPoints(30, seed));
      for (const endMode of ["return", "lastParcel"] as const) {
        expect(isPermutation(solveHeuristic(m, endMode), 30)).toBe(true);
      }
    }
  });

  it("원 위에 놓인 20개 필지는 원 순서대로 도는 최단 경로를 찾는다 (복귀)", () => {
    const n = 20;
    const pts: Pt[] = [[0, 0]];
    // 출발지는 원 위의 한 점과 같은 위치로 둔다
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push([50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)]);
    }
    pts[0] = [pts[1][0], pts[1][1]];
    const m = euclid(pts);
    const perimeter = n * 2 * 40 * Math.sin(Math.PI / n);
    expect(pathCost(solveHeuristic(m, "return"), m, "return")).toBeCloseTo(perimeter, 3);
  });

  it("일직선 위 15개는 끝까지 한 방향으로 간다 (마지막 필지 종료)", () => {
    const pts: Pt[] = [[0, 0], ...Array.from({ length: 15 }, (_, i) => [(15 - i) * 10, 0] as Pt)];
    const m = euclid(pts);
    expect(pathCost(solveHeuristic(m, "lastParcel"), m, "lastParcel")).toBeCloseTo(150, 6);
  });

  it("무작위 배치에서 단순히 가까운 곳부터 잇는 방법보다 나쁘지 않다", () => {
    const m = euclid(randomPoints(25, 9));
    const n = 25;
    // 가까운 곳부터 잇기
    const left = new Set(Array.from({ length: n }, (_, i) => i + 1));
    const nn: number[] = [];
    let from = 0;
    while (left.size) {
      const next = [...left].sort((a, b) => m[from][a] - m[from][b])[0];
      nn.push(next);
      left.delete(next);
      from = next;
    }
    expect(pathCost(solveHeuristic(m, "return"), m, "return")).toBeLessThanOrEqual(pathCost(nn, m, "return") + 1e-9);
  });

  it("같은 입력이면 같은 순서가 나온다", () => {
    const m = euclid(randomPoints(20, 4));
    expect(solveHeuristic(m, "return", 5000)).toEqual(solveHeuristic(m, "return", 5000));
  });

  it("시간 제한 안에 끝난다 (30개)", () => {
    const m = euclid(randomPoints(30, 11));
    const t = performance.now();
    solveHeuristic(m, "return");
    expect(performance.now() - t).toBeLessThan(2500);
  });
});

describe("solveOrder — 필지 수에 따라 방법을 고른다", () => {
  it("12개 이하는 정확, 13개부터는 근사", () => {
    expect(solveOrder(euclid(randomPoints(12, 2)), "return").exact).toBe(true);
    expect(solveOrder(euclid(randomPoints(13, 2)), "return").exact).toBe(false);
  });

  it("이동 시간 합을 함께 돌려준다", () => {
    const m = euclid([[0, 0], [3, 4], [6, 8]]);
    const r = solveOrder(m, "return");
    // 1→2→출발지와 2→1→출발지는 둘 다 20이라 어느 쪽이 나와도 최단이다
    expect([...r.order].sort()).toEqual([1, 2]);
    expect(r.travelCost).toBeCloseTo(20, 6);
    expect(r.travelCost).toBeCloseTo(pathCost(r.order, m, "return"), 6);
  });
});
