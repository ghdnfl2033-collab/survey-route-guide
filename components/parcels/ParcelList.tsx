import { MAX_PARCELS_PER_ROUTE, type Parcel } from "@/lib/core/types";

// Design Ref: §3.3 ② 필지 고르기 — 위치를 찾은 필지를 체크박스로 골라 동선에 넣는다 (최대 30필지)
export default function ParcelList({
  parcels,
  selectedIds,
  notice,
  onToggle,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onRepick,
  pickingId,
}: {
  parcels: Parcel[];
  selectedIds: string[];
  notice: string;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** 선택한 필지를 목록에서 삭제 (확인은 부르는 쪽에서) */
  onDeleteSelected: () => void;
  onRepick: (id: string) => void;
  pickingId: string | null;
}) {
  const located = parcels.filter((p) => p.coord);
  const selected = new Set(selectedIds);

  if (parcels.length === 0) {
    return <p className="text-sm text-zinc-500">목록을 올리거나 저장한 묶음을 불러오면 필지가 여기에 나와요.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          위치를 찾은 필지 <strong>{located.length}곳</strong>
          <span className="ml-2" aria-live="polite">
            · 선택 <strong>{selectedIds.length}/{MAX_PARCELS_PER_ROUTE}</strong>
          </span>
        </p>
        <div className="flex shrink-0 gap-1 text-xs">
          <button type="button" onClick={onSelectAll} disabled={located.length === 0} className="rounded border border-zinc-400 px-2 py-0.5 disabled:opacity-50">
            전체선택
          </button>
          <button type="button" onClick={onClearSelection} disabled={selectedIds.length === 0} className="rounded border border-zinc-400 px-2 py-0.5 disabled:opacity-50">
            선택 해제
          </button>
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={selectedIds.length === 0 || pickingId !== null}
            className="rounded border border-red-400 px-2 py-0.5 text-red-700 disabled:opacity-50 dark:text-red-400"
          >
            선택 삭제
          </button>
        </div>
      </div>

      {notice && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{notice}</p>
      )}

      <ul className="max-h-52 space-y-1 overflow-y-auto text-xs">
        {located.map((p) => (
          <li key={p.id} className="flex items-start gap-2">
            <input
              id={`sel-${p.id}`}
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() => onToggle(p.id)}
              className="mt-0.5"
            />
            <label htmlFor={`sel-${p.id}`} className="cursor-pointer">
              {p.address}{" "}
              <span className="text-zinc-400">
                {p.rowNumbers.length > 0
                  ? `(${p.rowNumbers.join(", ")}번째 줄${p.rowNumbers.length > 1 ? " — 합침" : ""})`
                  : "(묶음에서 불러옴)"}
              </span>
            </label>
            {p.coordSource === "manual" && (
              <span className="shrink-0">
                <span className="rounded bg-blue-100 px-1 text-blue-800 dark:bg-blue-900 dark:text-blue-200">직접 찍음</span>
                <button
                  type="button"
                  onClick={() => onRepick(p.id)}
                  disabled={p.id === pickingId}
                  className="ml-1 underline disabled:opacity-60"
                >
                  {p.id === pickingId ? "찍는 중…" : "다시 찍기"}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
