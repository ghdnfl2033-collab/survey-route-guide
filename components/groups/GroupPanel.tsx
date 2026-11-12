"use client";

import { useState } from "react";
import { MAX_GROUPS, MAX_GROUP_NAME_LENGTH, type ParcelGroup } from "@/lib/core/groups";

// Design Ref: §3.3 ② 필지 고르기 — 묶음으로 저장 / 묶음 불러오기·이름 바꾸기·삭제 (nice 2, 이 컴퓨터의 브라우저에만 저장)
export default function GroupPanel({
  groups,
  selectedCount,
  notice,
  onSave,
  onLoad,
  onRename,
  onDelete,
}: {
  groups: ParcelGroup[];
  selectedCount: number;
  /** 저장·이름 바꾸기·불러오기 결과 안내 */
  notice: string;
  /** 저장·이름 바꾸기가 받아들여졌으면 true (문제가 있으면 notice에 이유가 나오고 false) */
  onSave: (name: string) => boolean;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputClass = "min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-600";
  const btn = "rounded border border-zinc-400 px-2 py-0.5 disabled:opacity-50";

  return (
    <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-700">
      <h3 className="text-sm font-semibold">필지 묶음</h3>

      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (onSave(name)) setName("");
        }}
      >
        <input
          type="text"
          value={name}
          maxLength={MAX_GROUP_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: ○○동 1차 조사"
          aria-label="묶음 이름"
          className={inputClass}
        />
        <button type="submit" disabled={selectedCount === 0} className={btn}>
          묶음으로 저장
        </button>
      </form>
      <p className="text-zinc-500">
        지금 고른 필지({selectedCount}곳)의 주소와 위치만 이 컴퓨터의 브라우저에 저장해요. 서버로 보내지 않고, 다른 컴퓨터에서는 보이지 않으며, 브라우저 기록을 지우면 함께 지워져요. ({groups.length}/{MAX_GROUPS}개)
      </p>

      {notice && (
        <p role="status" aria-live="polite" className="text-blue-700 dark:text-blue-400">
          {notice}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-zinc-500">저장한 묶음이 없어요.</p>
      ) : (
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-1">
              {editingId === g.id ? (
                <form
                  className="flex w-full gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (onRename(g.id, editName)) setEditingId(null);
                  }}
                >
                  <input
                    type="text"
                    value={editName}
                    maxLength={MAX_GROUP_NAME_LENGTH}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label={`${g.name} 새 이름`}
                    className={inputClass}
                    autoFocus
                  />
                  <button type="submit" className={btn}>확인</button>
                  <button type="button" onClick={() => setEditingId(null)} className={btn}>취소</button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-all">
                    <strong>{g.name}</strong>
                    <span className="ml-1 text-zinc-500">
                      {g.parcels.length}곳 · {g.savedAt.slice(0, 10)}
                    </span>
                  </span>
                  <button type="button" onClick={() => onLoad(g.id)} className={btn} aria-label={`${g.name} 불러오기`}>
                    불러오기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(g.id);
                      setEditName(g.name);
                    }}
                    className={btn}
                    aria-label={`${g.name} 이름 바꾸기`}
                  >
                    이름 바꾸기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`'${g.name}' 묶음을 지울까요? 지우면 되돌릴 수 없어요.`)) onDelete(g.id);
                    }}
                    className={btn}
                    aria-label={`${g.name} 삭제`}
                  >
                    삭제
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
