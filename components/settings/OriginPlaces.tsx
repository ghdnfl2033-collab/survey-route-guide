"use client";

import { useState } from "react";
import { MAX_FAVORITE_NAME, MAX_FAVORITES, type PlaceEntry, type StoredPlaces } from "@/lib/core/places";

const smallButton = "rounded border border-zinc-400 px-2 py-1 text-xs disabled:opacity-50";

// 출발지 즐겨찾기(집·회사 등)와 최근 출발지 기록. 이 컴퓨터의 브라우저에만 저장된다.
export default function OriginPlaces({
  places,
  canSave,
  notice,
  onSelect,
  onSaveFavorite,
  onRemoveFavorite,
  onRemoveRecent,
  onClearAll,
}: {
  places: StoredPlaces;
  /** 지금 출발지 위치가 정해져 있어 즐겨찾기로 등록할 수 있는지 */
  canSave: boolean;
  notice: string;
  onSelect: (place: PlaceEntry) => void;
  /** 등록에 성공하면 true (이름 입력칸을 닫는다) */
  onSaveFavorite: (name: string) => boolean;
  onRemoveFavorite: (id: string) => void;
  onRemoveRecent: (place: PlaceEntry) => void;
  onClearAll: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [showRecents, setShowRecents] = useState(false);
  const hasAny = places.favorites.length > 0 || places.recents.length > 0;

  function save() {
    if (onSaveFavorite(name)) {
      setName("");
      setNaming(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {places.favorites.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="즐겨찾기 출발지">
          {places.favorites.map((f) => (
            <span key={f.id} className="inline-flex items-center overflow-hidden rounded-full border border-blue-600 text-xs">
              <button type="button" onClick={() => onSelect(f)} title={f.address} className="px-2.5 py-1 font-medium text-blue-700 dark:text-blue-300">
                {f.name}
              </button>
              <button type="button" onClick={() => onRemoveFavorite(f.id)} aria-label={`${f.name} 즐겨찾기 삭제`} className="border-l border-blue-600 px-1.5 py-1 text-zinc-500">
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {naming ? (
          <>
            <input
              type="text"
              value={name}
              maxLength={MAX_FAVORITE_NAME}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="예: 집, 회사"
              aria-label="즐겨찾기 이름"
              className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-600"
            />
            <button type="button" onClick={save} className={smallButton}>등록</button>
            <button type="button" onClick={() => setNaming(false)} className={smallButton}>취소</button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            disabled={!canSave || places.favorites.length >= MAX_FAVORITES}
            title={canSave ? "" : "출발지 위치를 먼저 정해 주세요"}
            className={smallButton}
          >
            ★ 즐겨찾기 등록
          </button>
        )}
        {places.recents.length > 0 && (
          <button type="button" onClick={() => setShowRecents((v) => !v)} aria-expanded={showRecents} className={smallButton}>
            최근 출발지 {places.recents.length}
          </button>
        )}
      </div>

      {notice && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{notice}</p>}

      {showRecents && places.recents.length > 0 && (
        <ul className="max-h-40 divide-y divide-zinc-200 overflow-y-auto rounded border border-zinc-300 text-xs dark:divide-zinc-700 dark:border-zinc-600">
          {places.recents.map((r) => (
            <li key={`${r.coord.lat},${r.coord.lng}`} className="flex items-center">
              <button type="button" onClick={() => onSelect(r)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left">
                {r.address}
              </button>
              <button type="button" onClick={() => onRemoveRecent(r)} aria-label={`${r.address} 기록 삭제`} className="px-2 py-1.5 text-zinc-500">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasAny && (
        <p className="text-xs text-zinc-500">
          이 컴퓨터의 브라우저에만 저장돼요. 공용 컴퓨터라면 쓴 뒤 지워 주세요.{" "}
          <button type="button" onClick={onClearAll} className="underline">모두 지우기</button>
        </p>
      )}
    </div>
  );
}
