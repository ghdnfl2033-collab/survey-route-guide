"use client";

import { useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DEPART_TIME,
  DEFAULT_DRAFT_VALUES,
  END_MODE_LABELS,
  MAX_INSPECT_MINUTES,
  MIN_INSPECT_MINUTES,
  MODE_LABELS,
  todayString,
  validateSettings,
  type SettingsErrors,
} from "@/lib/core/settings";
import type { Coord, RouteSettings, TravelMode } from "@/lib/core/types";
import OriginPlaces from "@/components/settings/OriginPlaces";
import type { PlaceEntry, StoredPlaces } from "@/lib/core/places";

export type OriginStatus = "idle" | "searching" | "found" | "notFound" | "error";

export type OriginState = {
  address: string;
  coord: Coord | null;
  status: OriginStatus;
  message: string;
};

const inputClass = "mt-1 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-600";
const smallButton = "rounded border border-zinc-400 px-2 py-1 text-xs disabled:opacity-50";

const subscribeNothing = () => () => {};

// Design Ref: §3.3 ③ 동선 설정 — 출발지, 조사 날짜·출발 시각, 끝내는 곳, 이동 수단, 필지당 조사 시간
export default function RouteSettingsForm({
  origin,
  onOriginAddressChange,
  onFindOrigin,
  onPickOrigin,
  pickingOrigin,
  places,
  placeNotice,
  onSelectPlace,
  onSaveFavorite,
  onRemoveFavorite,
  onRemoveRecent,
  onClearPlaces,
  selectedCount,
  busy,
  onSubmit,
  onChange,
}: {
  origin: OriginState;
  onOriginAddressChange: (address: string) => void;
  onFindOrigin: () => void;
  onPickOrigin: () => void;
  pickingOrigin: boolean;
  /** 저장해 둔 즐겨찾기·최근 출발지 */
  places: StoredPlaces;
  placeNotice: string;
  onSelectPlace: (place: PlaceEntry) => void;
  onSaveFavorite: (name: string) => boolean;
  onRemoveFavorite: (id: string) => void;
  onRemoveRecent: (place: PlaceEntry) => void;
  onClearPlaces: () => void;
  selectedCount: number;
  /** 동선을 계산하는 중이면 버튼을 막는다 */
  busy: boolean;
  onSubmit: (settings: RouteSettings) => void;
  /** 날짜·시각·끝내는 곳·이동 수단·조사 시간 중 하나라도 바꾸면 알린다 (이전 결과가 오래됐음을 보여 주는 데 쓴다) */
  onChange?: () => void;
}) {
  // 조사 날짜는 이 컴퓨터의 오늘 날짜를 기본으로 보여 준다. 사용자가 고르면 그 값을 쓴다.
  // (서버와 브라우저의 날짜가 달라 생기는 오류를 피하려고, 서버에서 그릴 때는 빈 값으로 둔다)
  const today = useSyncExternalStore(subscribeNothing, () => todayString(), () => "");
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const date = pickedDate ?? today;
  const setDate = setPickedDate;
  const [departTime, setDepartTime] = useState(DEFAULT_DEPART_TIME);
  const [endMode, setEndMode] = useState<RouteSettings["endMode"]>(DEFAULT_DRAFT_VALUES.endMode);
  const [mode, setMode] = useState<TravelMode>(DEFAULT_DRAFT_VALUES.mode);
  const [inspectMinutes, setInspectMinutes] = useState<string>(DEFAULT_DRAFT_VALUES.inspectMinutes);
  const [errors, setErrors] = useState<SettingsErrors>({});

  const searching = origin.status === "searching";

  /** 값을 고치면 그 항목의 이전 오류 안내는 지운다 */
  function clearError(field: keyof SettingsErrors) {
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateSettings(
      { originAddress: origin.address, originCoord: origin.coord, date, departTime, endMode, mode, inspectMinutes },
      todayString(),
    );
    if (result.ok) {
      setErrors({});
      onSubmit(result.settings);
    } else {
      setErrors(result.errors);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm" noValidate>
      {/* 출발지 */}
      <div>
        <label htmlFor="origin-address" className="font-medium">출발지 (사무실 등)</label>
        <div className="flex gap-1">
          <input
            id="origin-address"
            type="text"
            value={origin.address}
            onChange={(e) => onOriginAddressChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onFindOrigin();
              }
            }}
            placeholder="예: 서울 중구 세종대로 110"
            className={inputClass}
          />
          <button type="button" onClick={onFindOrigin} disabled={searching || origin.address.trim() === ""} className={`${smallButton} mt-1 shrink-0`}>
            {searching ? "찾는 중…" : "위치 찾기"}
          </button>
        </div>
        {origin.status === "found" && <p className="mt-1 text-xs text-green-700 dark:text-green-400">출발지 위치를 정했어요. (지도의 빨간 마커)</p>}
        {(origin.status === "notFound" || origin.status === "error") && (
          <p role="alert" className="mt-1 text-xs text-red-600">{origin.message}</p>
        )}
        <button type="button" onClick={onPickOrigin} disabled={pickingOrigin} className={`${smallButton} mt-1`}>
          {pickingOrigin ? "찍는 중…" : "지도에서 직접 찍기"}
        </button>
        <OriginPlaces
          places={places}
          canSave={origin.coord !== null}
          notice={placeNotice}
          onSelect={onSelectPlace}
          onSaveFavorite={onSaveFavorite}
          onRemoveFavorite={onRemoveFavorite}
          onRemoveRecent={onRemoveRecent}
          onClearAll={onClearPlaces}
        />
        {errors.origin && !origin.coord && <p role="alert" className="mt-1 text-xs text-red-600">{errors.origin}</p>}
      </div>

      {/* 날짜·출발 시각 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="survey-date" className="font-medium">조사 날짜</label>
          <input id="survey-date" type="date" value={date} onChange={(e) => {
            setDate(e.target.value);
            clearError("date");
            onChange?.();
          }} className={inputClass} />
          {errors.date && <p role="alert" className="mt-1 text-xs text-red-600">{errors.date}</p>}
        </div>
        <div>
          <label htmlFor="depart-time" className="font-medium">출발 시각</label>
          <input id="depart-time" type="time" value={departTime} onChange={(e) => {
            setDepartTime(e.target.value);
            clearError("departTime");
            onChange?.();
          }} className={inputClass} />
          {errors.departTime && <p role="alert" className="mt-1 text-xs text-red-600">{errors.departTime}</p>}
        </div>
      </div>

      {/* 끝내는 곳 */}
      <fieldset>
        <legend className="font-medium">동선 끝내는 곳</legend>
        <div className="mt-1 space-y-1">
          {(Object.keys(END_MODE_LABELS) as RouteSettings["endMode"][]).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="end-mode" checked={endMode === value} onChange={() => {
                  setEndMode(value);
                  onChange?.();
                }} />
              {END_MODE_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 이동 수단 */}
      <fieldset>
        <legend className="font-medium">이동 수단</legend>
        <div className="mt-1 flex gap-1" role="radiogroup">
          {(Object.keys(MODE_LABELS) as TravelMode[]).map((value) => (
            <label
              key={value}
              className={`flex-1 cursor-pointer rounded border px-2 py-1.5 text-center ${
                mode === value ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 dark:border-zinc-600"
              }`}
            >
              <input type="radio" name="travel-mode" className="sr-only" checked={mode === value} onChange={() => {
                setMode(value);
                onChange?.();
              }} />
              {MODE_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 필지당 조사 시간 */}
      <div>
        <label htmlFor="inspect-minutes" className="font-medium">필지당 조사 시간 (분)</label>
        <input
          id="inspect-minutes"
          type="number"
          inputMode="numeric"
          min={MIN_INSPECT_MINUTES}
          max={MAX_INSPECT_MINUTES}
          step={1}
          value={inspectMinutes}
          onChange={(e) => {
            setInspectMinutes(e.target.value);
            clearError("inspectMinutes");
            onChange?.();
          }}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-zinc-500">기본 10분이에요. 필요하면 바꿔 주세요. ({MIN_INSPECT_MINUTES}~{MAX_INSPECT_MINUTES}분)</p>
        {errors.inspectMinutes && <p role="alert" className="mt-1 text-xs text-red-600">{errors.inspectMinutes}</p>}
      </div>

      <div>
        <button
          type="submit"
          disabled={selectedCount === 0 || busy}
          className="w-full rounded bg-blue-600 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "계산 중…" : "동선 만들기"}
        </button>
        {selectedCount === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">동선에 넣을 필지를 먼저 골라 주세요.</p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">선택한 필지 {selectedCount}곳으로 만들어요.</p>
        )}
      </div>
    </form>
  );
}
