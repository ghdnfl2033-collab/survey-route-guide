import { describe, expect, it } from "vitest";
import {
  addFavorite,
  addRecent,
  MAP_PICK_LABEL,
  MAX_FAVORITES,
  MAX_RECENT_ORIGINS,
  parseStoredPlaces,
  removeFavorite,
  removeRecent,
  type Favorite,
} from "@/lib/core/places";

const at = (n: number) => ({ address: `서울 ${n}`, coord: { lat: 37 + n / 1000, lng: 127 } });

describe("최근 출발지", () => {
  it("최근 것이 맨 앞에 오고 10개를 넘으면 오래된 것부터 버린다", () => {
    let list = [] as ReturnType<typeof addRecent>;
    for (let i = 0; i < 12; i++) list = addRecent(list, at(i));
    expect(list).toHaveLength(MAX_RECENT_ORIGINS);
    expect(list[0].address).toBe("서울 11");
    expect(list.some((r) => r.address === "서울 0")).toBe(false);
  });

  it("같은 위치는 하나로 합쳐 맨 앞으로 올린다", () => {
    const list = addRecent(addRecent(addRecent([], at(1)), at(2)), { address: "새 이름", coord: at(1).coord });
    expect(list.map((r) => r.address)).toEqual(["새 이름", "서울 2"]);
  });

  it("주소가 비면 '지도에서 찍은 위치'로 적고, 삭제할 수 있다", () => {
    const list = addRecent([], { address: "  ", coord: at(1).coord });
    expect(list[0].address).toBe(MAP_PICK_LABEL);
    expect(removeRecent(list, at(1).coord)).toEqual([]);
  });
});

describe("즐겨찾기", () => {
  const ok = (r: ReturnType<typeof addFavorite>) => {
    if (!r.ok) throw new Error(r.message);
    return r.favorites;
  };

  it("이름을 붙여 등록하고 삭제한다", () => {
    const favs = ok(addFavorite([], "  회사 ", at(1), "a"));
    expect(favs[0]).toMatchObject({ id: "a", name: "회사", address: "서울 1" });
    expect(removeFavorite(favs, "a")).toEqual([]);
  });

  it("이름이 비었거나 길거나 겹치면 거부한다", () => {
    expect(addFavorite([], " ", at(1), "a").ok).toBe(false);
    expect(addFavorite([], "가".repeat(11), at(1), "a").ok).toBe(false);
    const favs = ok(addFavorite([], "집", at(1), "a"));
    expect(addFavorite(favs, "집", at(2), "b").ok).toBe(false);
  });

  it("5개를 넘으면 거부한다", () => {
    let favs: Favorite[] = [];
    for (let i = 0; i < MAX_FAVORITES; i++) favs = ok(addFavorite(favs, `이름${i}`, at(i), `id${i}`));
    expect(addFavorite(favs, "여섯째", at(9), "x").ok).toBe(false);
  });
});

describe("저장소에서 읽기", () => {
  it("비었거나 깨졌으면 빈 목록", () => {
    expect(parseStoredPlaces(null)).toEqual({ recents: [], favorites: [] });
    expect(parseStoredPlaces("{깨짐")).toEqual({ recents: [], favorites: [] });
    expect(parseStoredPlaces("123")).toEqual({ recents: [], favorites: [] });
  });

  it("모양이 틀렸거나 한국 밖인 항목은 버리고 주소·좌표 외 값은 걸러 낸다", () => {
    const raw = JSON.stringify({
      recents: [at(1), { address: "일본", coord: { lat: 35.6, lng: 139.7 } }, { address: 1 }],
      favorites: [{ id: "a", name: "집", ...at(2), extra: "개인정보" }, { id: "b" }],
    });
    const p = parseStoredPlaces(raw);
    expect(p.recents).toEqual([at(1)]);
    expect(p.favorites).toEqual([{ id: "a", name: "집", ...at(2) }]);
  });
});
