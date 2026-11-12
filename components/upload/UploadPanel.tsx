"use client";

import { useState } from "react";
import { readParcelFile, type ExcelReadResult } from "@/lib/client/excel";
import { mergeDuplicateAddresses, type MergeResult, type MergedAddress } from "@/lib/core/address";
import { MAX_PASTE_LINES, parsePastedText } from "@/lib/core/pasteText";

const PASTE_PLACEHOLDER = ["한 줄에 지번 주소 하나씩", "예) 서울 종로구 청운동 1-1", "    서울 종로구 청운동 2-3"].join("\n");

type Loaded = { read: Extract<ExcelReadResult, { ok: true }>; merged: MergeResult };

// Design Ref: §3.3 ① 목록 올리기 — 파일 선택, 개인정보 안내, 읽은 결과·합친 결과 안내
// 읽고 합친 주소 목록은 onLoaded로 넘기고, 위치 찾기는 작업 공간(Workspace)이 이어서 한다.
export default function UploadPanel({
  onLoaded,
  onAdd,
  existingAddresses,
  nextRow,
  disabled = false,
}: {
  onLoaded: (addresses: MergedAddress[]) => void;
  /** 붙여넣은 주소를 지금 목록에 추가한다 */
  onAdd: (addresses: MergedAddress[]) => void;
  /** 지금 목록에 있는 주소들 (붙여넣은 주소가 겹치면 건너뛴다) */
  existingAddresses: readonly string[];
  /** 새로 추가하는 주소에 붙일 원본 줄 번호의 시작 값 */
  nextRow: number;
  disabled?: boolean;
}) {
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [pasteInfo, setPasteInfo] = useState<string[]>([]);

  function addPasted() {
    const r = parsePastedText(pasteText, existingAddresses, nextRow);
    if (!r.ok) {
      setPasteError(r.message);
      setPasteInfo([]);
      return;
    }
    setPasteError("");
    const info: string[] = [];
    if (r.parcels.length > 0) info.push(`주소 ${r.parcels.length}곳을 추가했어요.`);
    else info.push("새로 추가할 주소가 없어요.");
    if (r.mergedCount > 0) info.push(`같은 주소가 겹쳐 ${r.mergedCount}건을 하나로 합쳤어요.`);
    if (r.alreadyCount > 0) info.push(`이미 목록에 있는 ${r.alreadyCount}곳은 건너뛰었어요.`);
    if (r.unreadableLines.length > 0) info.push(`${r.unreadableLines.join(", ")}번째 줄은 주소로 읽지 못했어요. (너무 긴 줄)`);
    setPasteInfo(info);
    if (r.parcels.length > 0) {
      onAdd(r.parcels);
      setPasteText("");
    }
  }

  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    const result = await readParcelFile(file);
    if (result.ok) {
      const merged = mergeDuplicateAddresses(result.addresses);
      setError("");
      setLoaded({ read: result, merged });
      onLoaded(merged.parcels);
    } else {
      setLoaded(null);
      setError(result.message);
    }
    setBusy(false);
    input.value = ""; // 같은 파일을 다시 올릴 수 있게 비움
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">엑셀 또는 CSV 파일 선택</span>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={onFileChange}
          disabled={busy || disabled}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"
        />
      </label>

      <p className="text-xs text-zinc-500">
        ⓘ 첫 번째 시트의 첫 번째 열에 지번 주소만 적어 올려 주세요. 제목 행 없이 첫 줄부터 읽어요.
        이름·연락처 같은 개인정보는 엑셀에 넣지 마세요.
      </p>

      <div className="space-y-1 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        <label htmlFor="paste-addresses" className="text-sm font-medium">주소 직접 붙여넣기</label>
        <textarea
          id="paste-addresses"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={4}
          disabled={disabled}
          placeholder={PASTE_PLACEHOLDER}
          className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-600"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addPasted}
            disabled={disabled || pasteText.trim() === ""}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            목록에 추가
          </button>
          <span className="text-xs text-zinc-500">최대 {MAX_PASTE_LINES}줄 · 지금 목록에 이어서 추가돼요</span>
        </div>
        <p className="text-xs text-zinc-500">엑셀에서 주소 칸을 복사해 붙여넣어도 돼요. 여러 열을 복사해도 첫 번째 열만 읽어요.</p>
        {pasteError && <p role="alert" className="text-sm text-red-600">{pasteError}</p>}
        {pasteInfo.length > 0 && (
          <div className="space-y-0.5 text-sm" aria-live="polite">
            {pasteInfo.map((line) => (
              <p key={line} className="text-zinc-700 dark:text-zinc-300">{line}</p>
            ))}
          </div>
        )}
      </div>

      {busy && <p className="text-sm">읽는 중…</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      )}

      {loaded && (
        <div className="space-y-1 text-sm" aria-live="polite">
          <p>
            <strong>{loaded.read.fileName}</strong>에서 주소 <strong>{loaded.merged.parcels.length}곳</strong>을 읽었어요.
          </p>
          {loaded.merged.mergedCount > 0 && (
            <p className="text-blue-700 dark:text-blue-400">
              같은 주소가 겹쳐 {loaded.merged.mergedCount}건을 하나로 합쳤어요.
            </p>
          )}
          {loaded.read.blankCount > 0 && (
            <p className="text-zinc-500">빈 줄 {loaded.read.blankCount}개는 건너뛰었어요.</p>
          )}
          {loaded.read.unreadableRows.length > 0 && (
            <p role="alert" className="text-red-600">
              {loaded.read.unreadableRows.join(", ")}번째 줄은 주소로 읽지 못했어요. (숫자·날짜이거나 너무 긴 칸)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
