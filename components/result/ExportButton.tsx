"use client";

import { useState } from "react";
import { downloadRouteExcel } from "@/lib/client/exportExcel";
import type { RoutePlan } from "@/lib/core/route";
import type { SurveyRecords } from "@/lib/core/survey";
import type { Parcel, RouteSettings } from "@/lib/core/types";

// Design Ref: §3.3 ④ 결과 — [엑셀 내려받기]. 파일은 브라우저에서만 만든다.
export default function ExportButton({
  settings,
  plan,
  parcels,
  records,
  excluded,
  onDownloaded,
}: {
  settings: RouteSettings;
  plan: RoutePlan;
  parcels: Parcel[];
  /** 조사 완료라서 이번 계산에서 뺀 필지 (엑셀 맨 아래에 기록과 함께 적는다) */
  excluded: Parcel[];
  records: SurveyRecords;
  /** 내려받기가 끝났을 때 (그 시점의 기록을 "저장함"으로 기억하게 한다) */
  onDownloaded: (records: SurveyRecords) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function onClick() {
    setBusy(true);
    setMessage("");
    try {
      const name = await downloadRouteExcel(settings, plan, parcels, records, excluded);
      onDownloaded(records);
      setMessage(`${name} 파일을 내려받았어요.`);
    } catch {
      setMessage("엑셀 파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || (plan.orderIds.length === 0 && excluded.length === 0)}
        className="rounded border border-zinc-400 px-3 py-1 text-xs font-medium disabled:opacity-50"
      >
        {busy ? "만드는 중…" : "엑셀 내려받기"}
      </button>
      {message && (
        <span role="status" aria-live="polite" className="text-xs text-zinc-600 dark:text-zinc-400">
          {message}
        </span>
      )}
    </div>
  );
}
