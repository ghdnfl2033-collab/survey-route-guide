import type { Parcel } from "@/lib/core/types";

// Design Ref: §3.3 ② — 위치를 찾지 못한 필지는 짐작하지 않고 "확인 필요"로 보여 주고, 지도에서 직접 찍게 한다
export default function NeedsCheckList({
  parcels,
  onRetry,
  onPick,
  pickingId,
  busy,
}: {
  parcels: Parcel[];
  onRetry: () => void;
  onPick: (id: string) => void;
  pickingId: string | null;
  busy: boolean;
}) {
  const needs = parcels.filter((p) => p.needsCheck);
  if (needs.length === 0) return null;
  const failedCount = needs.filter((p) => p.lookupFailed).length;

  return (
    <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <h3 className="font-semibold">⚠ 확인 필요 ({needs.length})</h3>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        위치를 찾지 못한 필지예요. 지도에서 직접 위치를 찍으면 동선에 넣을 수 있어요.
      </p>
      <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs">
        {needs.map((p) => {
          const picking = p.id === pickingId;
          return (
            <li key={p.id} className="flex items-start justify-between gap-2">
              <span>
                {p.address} <span className="text-zinc-400">({p.rowNumbers.join(", ")}번째 줄)</span>
                {p.lookupFailed && <span className="ml-1 text-red-600">일시 오류</span>}
              </span>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                disabled={busy || picking}
                className="shrink-0 rounded border border-zinc-400 px-2 py-0.5 disabled:opacity-60"
              >
                {picking ? "찍는 중…" : "지도에서 찍기"}
              </button>
            </li>
          );
        })}
      </ul>
      {failedCount > 0 && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="mt-2 rounded border border-zinc-400 px-3 py-1 text-xs disabled:opacity-50"
        >
          일시 오류 {failedCount}건 다시 찾기
        </button>
      )}
    </div>
  );
}
