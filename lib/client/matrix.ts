// Design Ref: §4.1 ⑤ — 좌표만 서버(/api/matrix)로 보내 자차 구간 시간표를 받는다.

import type { Timetable } from "@/lib/core/route";
import type { Coord } from "@/lib/core/types";

export class MatrixRequestError extends Error {
  /** 접속 코드가 만료되어 다시 입장해야 하는 경우 */
  readonly unauthorized: boolean;
  constructor(message: string, unauthorized = false) {
    super(message);
    this.name = "MatrixRequestError";
    this.unauthorized = unauthorized;
  }
}

function isSquare<T>(grid: unknown, size: number, check: (v: unknown) => v is T): grid is T[][] {
  return Array.isArray(grid) && grid.length === size && grid.every((row) => Array.isArray(row) && row.length === size && row.every(check));
}
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/** 지점 목록(0번이 출발지)의 자차 구간 시간표를 서버에서 받아 온다. 실패하면 MatrixRequestError. */
export async function fetchCarMatrix(points: readonly Coord[], fetchImpl: typeof fetch = fetch): Promise<Timetable> {
  let res: Response;
  try {
    res = await fetchImpl("/api/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, mode: "car" }),
    });
  } catch {
    throw new MatrixRequestError("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
  }

  if (res.status === 401) throw new MatrixRequestError("접속 시간이 지났어요. 다시 입장해 주세요.", true);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new MatrixRequestError(body?.error?.message ?? "길찾기 중 문제가 생겼어요.");

  const n = points.length;
  if (
    !body ||
    !isSquare(body.minutes, n, isNumber) ||
    !isSquare(body.km, n, isNumber) ||
    !isSquare(body.estimated, n, isBoolean)
  ) {
    throw new MatrixRequestError("서버 응답이 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.");
  }
  return {
    minutes: body.minutes,
    km: body.km,
    estimated: body.estimated,
    roadEnds: parseRoadEnds(body.roadEnds, n),
    noRoad: parseIndexes(body.noRoad, n),
  };
}

/** 도로에서 먼 필지의 도로 끝 정보. 모양이 맞지 않는 항목은 버린다(이 정보가 없어도 시간표는 쓸 수 있다). */
function parseRoadEnds(value: unknown, size: number): NonNullable<Timetable["roadEnds"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const r = v as { index?: unknown; lat?: unknown; lng?: unknown; meters?: unknown };
    return isNumber(r?.index) && r.index >= 1 && r.index < size && isNumber(r.lat) && isNumber(r.lng) && isNumber(r.meters)
      ? [{ index: r.index, coord: { lat: r.lat, lng: r.lng }, meters: r.meters }]
      : [];
  });
}

function parseIndexes(value: unknown, size: number): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => isNumber(v) && v >= 1 && v < size) : [];
}
