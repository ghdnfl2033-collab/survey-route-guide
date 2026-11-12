"use client";

import { useState } from "react";
import { readParcelFile, type ExcelReadResult } from "@/lib/client/excel";
import { mergeDuplicateAddresses, type MergeResult, type MergedAddress } from "@/lib/core/address";

type Loaded = { read: Extract<ExcelReadResult, { ok: true }>; merged: MergeResult };

// Design Ref: §3.3 ① 목록 올리기 — 파일 선택, 개인정보 안내, 읽은 결과·합친 결과 안내
// 읽고 합친 주소 목록은 onLoaded로 넘기고, 위치 찾기는 작업 공간(Workspace)이 이어서 한다.
export default function UploadPanel({
  onLoaded,
  disabled = false,
}: {
  onLoaded: (addresses: MergedAddress[]) => void;
  disabled?: boolean;
}) {
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
