import { describe, expect, it, vi } from "vitest";
import { fetchCarMatrix, MatrixRequestError } from "@/lib/client/matrix";

const pts = [
  { lat: 37.5, lng: 127 },
  { lat: 37.51, lng: 127.01 },
];
const ok = (over: object = {}) =>
  new Response(
    JSON.stringify({
      minutes: [[0, 5], [6, 0]],
      km: [[0, 1.2], [1.3, 0]],
      estimated: [[false, false], [false, true]],
      codes: [[null, 0], [0, null]],
      stats: {},
      ...over,
    }),
    { status: 200 },
  );

describe("fetchCarMatrix — 서버에서 자차 시간표 받기", () => {
  it("좌표와 이동 수단(car)만 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(ok());
    await fetchCarMatrix(pts, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/matrix");
    expect(JSON.parse(init.body)).toEqual({ points: pts, mode: "car" });
  });

  it("분·km·추정 여부를 시간표로 돌려준다 (필요 없는 값은 버린다)", async () => {
    const r = await fetchCarMatrix(pts, vi.fn().mockResolvedValue(ok()) as unknown as typeof fetch);
    expect(r).toEqual({
      minutes: [[0, 5], [6, 0]],
      km: [[0, 1.2], [1.3, 0]],
      estimated: [[false, false], [false, true]],
      roadEnds: [],
      noRoad: [],
    });
  });

  it("도로에서 먼 필지의 도로 끝 정보(roadEnds)와 도로를 못 찾은 필지(noRoad)를 받는다", async () => {
    const f = vi.fn().mockResolvedValue(ok({ roadEnds: [{ index: 1, lat: 37.4, lng: 127.1, meters: 640 }], noRoad: [1] }));
    const r = await fetchCarMatrix(pts, f as unknown as typeof fetch);
    expect(r.roadEnds).toEqual([{ index: 1, coord: { lat: 37.4, lng: 127.1 }, meters: 640 }]);
    expect(r.noRoad).toEqual([1]);
  });

  it("모양이 맞지 않는 도로 끝 정보는 버리고 시간표는 그대로 쓴다", async () => {
    const f = vi.fn().mockResolvedValue(
      ok({ roadEnds: [{ index: 0, lat: 1, lng: 1, meters: 1 }, { index: 1, lat: "x", lng: 1, meters: 1 }, null, { index: 5, lat: 1, lng: 1, meters: 1 }], noRoad: [0, 1, 9, "a"] }),
    );
    const r = await fetchCarMatrix(pts, f as unknown as typeof fetch);
    expect(r.roadEnds).toEqual([]); // 출발지(0번)와 범위 밖(5번), 잘못된 값은 모두 버림
    expect(r.noRoad).toEqual([1]);
    expect(r.minutes).toEqual([[0, 5], [6, 0]]);
  });

  it("401이면 다시 입장해야 한다는 오류", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(fetchCarMatrix(pts, f)).rejects.toMatchObject({ unauthorized: true });
  });

  it("서버가 안내 문구를 주면 그대로 전달한다", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "길찾기 설정을 확인해 주세요" } }), { status: 502 }));
    await expect(fetchCarMatrix(pts, f)).rejects.toThrow("길찾기 설정을 확인해 주세요");
  });

  it("네트워크가 끊기면 연결 안내 오류", async () => {
    const f = vi.fn().mockRejectedValue(new Error("net"));
    await expect(fetchCarMatrix(pts, f)).rejects.toBeInstanceOf(MatrixRequestError);
  });

  it("응답 모양이 어긋나면 오류 (크기·자료형)", async () => {
    for (const bad of [{ minutes: [[0]] }, { km: "x" }, { estimated: [[0, 0], [0, 0]] }, { minutes: [[0, "5"], [6, 0]] }]) {
      const f = vi.fn().mockResolvedValue(ok(bad));
      await expect(fetchCarMatrix(pts, f)).rejects.toBeInstanceOf(MatrixRequestError);
    }
  });
});
