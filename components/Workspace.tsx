"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import KakaoMap, { ROUTE_COLORS } from "@/components/map/KakaoMap";
import LogoutButton from "@/components/LogoutButton";
import UploadPanel from "@/components/upload/UploadPanel";
import GroupPanel from "@/components/groups/GroupPanel";
import { loadGroups, saveGroups } from "@/lib/client/groupStorage";
import { loadPlaces, savePlaces } from "@/lib/client/placeStorage";
import { addFavorite, addRecent, EMPTY_PLACES, removeFavorite, removeRecent, type PlaceEntry, type StoredPlaces } from "@/lib/core/places";
import { addGroup, applyGroup, deleteGroup, renameGroup, type ParcelGroup } from "@/lib/core/groups";
import ParcelList from "@/components/parcels/ParcelList";
import NeedsCheckList from "@/components/parcels/NeedsCheckList";
import RouteSettingsForm, { type OriginState } from "@/components/settings/RouteSettingsForm";
import { geocodeAddresses, GeocodeRequestError } from "@/lib/client/geocode";
import { applyRetryResults, buildParcels, isInKorea, setManualLocation } from "@/lib/core/parcels";
import { BLOCKED_MESSAGES, selectFirst, toggleSelection } from "@/lib/core/selection";
import { legPoints, moveInOrder, planRoute, repricePlan, reorderPlan, roadEndOverrides, routeDrawing, routePoints, splitPlanByDay, addDaysToDate, type LegActual, type RoutePlan, type Timetable } from "@/lib/core/route";
import { fetchCarMatrix, MatrixRequestError } from "@/lib/client/matrix";
import { fetchCarLegs, fetchTransitLegs, fetchWalkLegs, RouteLegsError } from "@/lib/client/routeLegs";
import ResultPanel from "@/components/result/ResultPanel";
import type { WeatherState } from "@/components/result/WeatherNotice";
import { centerOf, fetchForecasts } from "@/lib/client/weather";
import {
  hasUnsavedRecords,
  snapshotRecords,
  splitDone,
  UNSAVED_WARNING,
  updateRecord,
  type SurveyRecord,
  type SurveyRecords,
} from "@/lib/core/survey";
import type { MergedAddress } from "@/lib/core/address";
import type { Coord, Parcel, RouteSettings } from "@/lib/core/types";

type Lookup = { working: boolean; done: number; total: number; error: string };

/** 출발지 위치를 지도에서 찍는 중일 때 pickingId에 넣는 값 */
const ORIGIN_PICK = "__origin__";

const EMPTY_ORIGIN: OriginState = { address: "", coord: null, status: "idle", message: "" };

// Design Ref: §3.3 메인 화면 — 왼쪽: 목록·설정, 오른쪽: 지도, 아래: 결과 (필지·선택·설정 상태를 한곳에서 들고 있음)
export default function Workspace() {
  const router = useRouter();
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [lookup, setLookup] = useState<Lookup>({ working: false, done: 0, total: 0, error: "" });
  /** 지도에서 위치를 찍는 중인 필지 (출발지면 ORIGIN_PICK) */
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickNotice, setPickNotice] = useState("");
  /** 동선에 넣으려고 고른 필지 id (최대 30개) */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectNotice, setSelectNotice] = useState("");
  const [origin, setOrigin] = useState<OriginState>(EMPTY_ORIGIN);
  /** "동선 만들기"로 계산한 결과 (그때의 설정과 필지 목록, 직선거리로 대신 계산한 이유를 함께 들고 있음) */
  const [result, setResult] = useState<{
    settings: RouteSettings;
    plan: RoutePlan;
    parcels: Parcel[];
    excluded: Parcel[];
    notice: string;
    /** 여러 날로 나눈 경우 일차별 동선 (나누지 않았으면 null) */
    days: RoutePlan[] | null;
    /** 지금 보고 있는 일차 (0부터) */
    dayIndex: number;
  } | null>(null);
  /** 길찾기 시간표를 받아 계산하는 중인지 */
  const [routing, setRouting] = useState(false);
  /** 결과를 만든 뒤에 설정(날짜·시각·끝내는 곳·이동 수단·조사 시간)을 바꿨는지: 맞으면 결과 위에 "이전 설정 기준" 안내를 보인다 */
  const [settingsChanged, setSettingsChanged] = useState(false);
  /** 계산 요청 번호: 계산하는 동안 선택·위치·설정이 바뀌면 번호가 올라가서, 늦게 도착한 이전 결과를 버린다 */
  const routeJob = useRef(0);
  /** 조사 기록 (필지 id → 기록). 화면 상태에만 두고, 동선을 다시 만들어도 유지한다. 새 파일을 올리면 비운다 */
  const [records, setRecords] = useState<SurveyRecords>({});

  /** 마지막으로 엑셀을 내려받은 때의 기록 (이것과 다르면 "저장하지 않은 기록"이 있는 것) */
  const [savedSnapshot, setSavedSnapshot] = useState(snapshotRecords({}));
  const unsaved = hasUnsavedRecords(records, savedSnapshot);

  // 저장하지 않은 기록이 있는 채로 창을 닫거나 새로고침하려 하면 브라우저가 경고를 띄운다
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = UNSAVED_WARNING;
      return UNSAVED_WARNING;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  /** 저장해 둔 필지 묶음 (브라우저 저장소에서 읽는다) */
  const [groups, setGroups] = useState<ParcelGroup[]>([]);
  const [groupNotice, setGroupNotice] = useState("");
  useEffect(() => {
    // 저장소는 화면이 뜬 뒤에만 읽을 수 있다
    setGroups(loadGroups());
  }, []);

  /** 출발지 즐겨찾기·최근 출발지 (브라우저 저장소에서 읽는다) */
  const [places, setPlaces] = useState<StoredPlaces>(EMPTY_PLACES);
  const [placeNotice, setPlaceNotice] = useState("");
  const placesLoaded = useRef(false);
  useEffect(() => {
    setPlaces(loadPlaces());
    placesLoaded.current = true;
  }, []);

  /** 목록을 바꾸고 저장한다 (저장소를 못 쓰면 안내) */
  function updatePlaces(next: StoredPlaces) {
    setPlaces(next);
    setPlaceNotice(savePlaces(next) ? "" : "브라우저가 저장을 막아서 이 화면에서만 기억해요.");
  }

  // 출발지 위치가 정해지면 최근 출발지에 자동으로 기록한다
  useEffect(() => {
    if (!placesLoaded.current || origin.status !== "found" || !origin.coord) return;
    const entry = { address: origin.address, coord: origin.coord };
    setPlaces((current) => {
      const next = { ...current, recents: addRecent(current.recents, entry) };
      savePlaces(next);
      return next;
    });
  }, [origin.status, origin.coord, origin.address]);

  function selectPlace(place: PlaceEntry) {
    setOrigin({ address: place.address, coord: place.coord, status: "found", message: "" });
    setPlaceNotice("");
    clearResult();
  }

  function saveFavorite(name: string): boolean {
    if (!origin.coord) return false;
    const r = addFavorite(places.favorites, name, { address: origin.address, coord: origin.coord }, crypto.randomUUID());
    if (!r.ok) {
      setPlaceNotice(r.message);
      return false;
    }
    updatePlaces({ ...places, favorites: r.favorites });
    return true;
  }

  function handleRecordChange(parcelId: string, change: Partial<Omit<SurveyRecord, "parcelId">>) {
    setRecords((current) => updateRecord(current, parcelId, change));
  }

  /** 이전 결과와 진행 중인 계산을 모두 버린다 (필지·선택·위치가 바뀌어 더 이상 맞지 않을 때) */
  function clearResult() {
    routeJob.current += 1;
    setRouting(false);
    setRefreshing(false);
    setSettingsChanged(false);
    setResult(null);
  }

  const pickingParcel = parcels.find((p) => p.id === pickingId) ?? null;
  // 지도에 그릴 경로: 결과가 바뀔 때만 다시 만든다 (지도가 불필요하게 다시 그려지지 않게)
  // 여러 날로 나눈 경우 화면에는 고른 일차의 동선과 그날의 조사 날짜를 보여 준다
  const viewPlan = result ? (result.days ? result.days[result.dayIndex] : result.plan) : null;
  const viewSettings = result ? { ...result.settings, date: addDaysToDate(result.settings.date, result.days ? result.dayIndex : 0) } : null;
  const drawing = useMemo(
    () => (result && viewPlan && viewSettings ? routeDrawing(viewSettings, viewPlan, result.parcels) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result],
  );
  const pickingOrigin = pickingId === ORIGIN_PICK;

  // 검사를 통과한 설정과 고른 필지로 동선을 계산한다.
  // - 자차: 서버에서 실제 길찾기 시간표를 받아 순서를 계산한다.
  // - 도보: 직선거리로 순서를 정한 뒤(걷는 거리가 짧은 순서), 확정된 구간의 실제 걷는 시간·거리를 받아 다시 계산한다.
  // - 대중교통: 도보와 같은 방식. 구간마다 환승 횟수를 받고, 대중교통 경로가 없는 구간은 걷는 시간으로 대신한다("도보 구간").
  // 길찾기 값을 받지 못한 구간은 직선거리로 대신하고 "추정값"으로 표시한다.
  async function makeRoute(settings: RouteSettings) {
    // "조사 완료"로 표시한 필지는 이번 계산에서 뺀다 (기록은 그대로 둔다)
    const { active: chosen, excluded } = splitDone(
      parcels.filter((p) => selectedIds.includes(p.id) && p.coord),
      records,
    );
    const job = ++routeJob.current;
    setRefreshing(false);
    setSettingsChanged(false);
    setResult(null);
    if (chosen.length === 0) {
      // 남은 필지가 없으면 길찾기 없이 바로 알린다
      setResult({ settings, plan: planRoute(settings, []), parcels: [], excluded, notice: "", days: null, dayIndex: 0 });
    // (이 경우 결과 화면에는 "모두 조사 완료" 안내와 제외 필지 목록만 보인다)
      setRouting(false);
      return;
    }
    setRouting(true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // "계산 중" 표시가 먼저 그려지게 한다

    let plan: RoutePlan;
    let notice = "";
    try {
      if (settings.mode === "car") {
        let timetable: Timetable | undefined;
        try {
          timetable = await fetchCarMatrix(routePoints(settings, chosen));
        } catch (e) {
          if (e instanceof MatrixRequestError && e.unauthorized) throw e;
          notice = "길찾기 서비스에서 시간을 받지 못했어요. 잠시 뒤 다시 만들어 보세요.";
        }
        plan = planRoute(settings, chosen, timetable);
        // 순서가 정해진 뒤, 각 구간이 도로 끝에서 얼마나 떨어져 끝나는지 확인한다 (산 번지·임야 등).
        // 확인하지 못해도 시간표의 값은 그대로 쓸 수 있으므로 오류로 보지 않는다.
        if (timetable) {
          try {
            const points = legPoints(settings, plan, chosen, roadEndOverrides(settings, chosen, timetable));
            plan = repricePlan(settings, plan, await fetchCarLegs(points));
          } catch (e) {
            if (e instanceof RouteLegsError && e.unauthorized) throw e;
          }
        }
      } else if (settings.mode === "walk") {
        plan = planRoute(settings, chosen); // 직선거리 기준으로 순서를 정한다
        try {
          plan = repricePlan(settings, plan, await fetchWalkLegs(legPoints(settings, plan, chosen)));
        } catch (e) {
          if (e instanceof RouteLegsError && e.unauthorized) throw e;
          notice = "길찾기 서비스에서 걷는 시간을 받지 못했어요. 잠시 뒤 다시 만들어 보세요.";
        }
      } else {
        // 대중교통: 직선거리로 순서를 정한 뒤, 확정된 구간의 실제 시간·환승 횟수를 받는다 (경로가 없는 구간은 도보 구간)
        plan = planRoute(settings, chosen);
        try {
          plan = repricePlan(settings, plan, await fetchTransitLegs(legPoints(settings, plan, chosen)));
        } catch (e) {
          if (e instanceof RouteLegsError && e.unauthorized) throw e;
          notice = "길찾기 서비스에서 대중교통 시간을 받지 못했어요. 잠시 뒤 다시 만들어 보세요.";
        }
      }
    } catch (e) {
      if ((e instanceof MatrixRequestError || e instanceof RouteLegsError) && e.unauthorized) {
        router.replace("/login"); // 접속 시간이 지났다
        return;
      }
      setRouting(false); // 예상하지 못한 오류: 계산 중 표시를 풀고 오류는 그대로 드러낸다
      throw e;
    }

    if (job !== routeJob.current) return; // 계산하는 사이에 선택·위치·설정이 바뀌었으면 이 결과는 버린다
    setResult({ settings, plan, parcels: chosen, excluded, notice, days: null, dayIndex: 0 });
    loadWeather(chosen);
    setRouting(false);
  }

  /** 조사 지역의 날씨 예보 (nice). 가져오지 못해도 동선 계산에는 영향이 없다 */
  const [weather, setWeather] = useState<WeatherState>({ status: "done", forecasts: null });
  const weatherJob = useRef(0);

  /** 고른 필지들의 가운데 위치로 날씨를 받아 온다 (좌표만 보낸다). 결과가 바뀌는 사이 늦게 온 응답은 버린다. */
  function loadWeather(chosen: Parcel[]) {
    const center = centerOf(chosen.flatMap((p) => (p.coord ? [p.coord] : [])));
    const job = ++weatherJob.current;
    if (!center) {
      setWeather({ status: "done", forecasts: null });
      return;
    }
    setWeather({ status: "loading" });
    fetchForecasts(center).then((forecasts) => {
      if (job === weatherJob.current) setWeather({ status: "done", forecasts });
    });
  }

  /** 순서를 직접 바꾸는 중에 새 구간의 시간을 길찾기로 확인하고 있는지 */
  const [refreshing, setRefreshing] = useState(false);

  /**
   * 새로 생긴 구간(freshLegIndexes)만 길찾기로 확인해 실제 값으로 바꾼다. 못 받은 구간은 추정값으로 남는다.
   * 접속 코드가 만료됐으면 null을 돌려준다(호출한 쪽에서 다시 입장하게 한다).
   */
  async function refreshLegs(settings: RouteSettings, plan: RoutePlan, chosen: Parcel[], fresh: number[]): Promise<RoutePlan | null> {
    if (fresh.length === 0) return plan;
    const points = legPoints(settings, plan, chosen);
    const fetchLegs = settings.mode === "car" ? fetchCarLegs : settings.mode === "walk" ? fetchWalkLegs : fetchTransitLegs;
    const actuals: LegActual[] = plan.legs.map(() => ({ ok: false }));
    const settled = await Promise.allSettled(fresh.map((i) => fetchLegs([points[i], points[i + 1]])));
    if (settled.some((r) => r.status === "rejected" && r.reason instanceof RouteLegsError && r.reason.unauthorized)) return null;
    settled.forEach((r, k) => {
      if (r.status === "fulfilled" && r.value[0]) actuals[fresh[k]] = r.value[0];
    });
    return repricePlan(settings, plan, actuals);
  }

  // 결과표에서 필지 하나를 다른 자리로 옮긴다: 바로 새 순서로 다시 계산하고(새 구간은 추정값),
  // 새로 생긴 구간만 길찾기로 확인해 실제 값으로 바꾼다. 앞뒤가 그대로인 구간은 다시 조회하지 않는다.
  // 여러 날로 나눈 상태에서는 지금 보고 있는 일차 안에서만 순서가 바뀐다.
  async function handleMove(from: number, to: number) {
    if (!result || !viewPlan || routing) return;
    const { settings, parcels: chosen, dayIndex } = result;
    const next = reorderPlan(settings, viewPlan, chosen, moveInOrder(viewPlan.orderIds, from, to));
    if (next.freshLegIndexes.length === 0) return;
    const job = ++routeJob.current;
    const put = (plan: RoutePlan) =>
      setResult((current) => {
        if (!current) return current;
        return current.days
          ? { ...current, days: current.days.map((d, i) => (i === dayIndex ? plan : d)) }
          : { ...current, plan };
      });
    put(next.plan);
    setRefreshing(true);
    const repriced = await refreshLegs(settings, next.plan, chosen, next.freshLegIndexes);
    if (job !== routeJob.current) return; // 그 사이 또 바꿨거나 새로 계산했으면 이 결과는 버린다
    if (!repriced) {
      router.replace("/login");
      return;
    }
    put(repriced);
    setRefreshing(false);
  }

  // 필지가 많을 때 하루 18곳씩 나눈다. 일차마다 새로 생긴 구간만 길찾기로 확인한다.
  async function handleSplit() {
    if (!result || result.days || routing) return;
    const { settings, parcels: chosen } = result;
    const split = splitPlanByDay(settings, result.plan, chosen);
    if (split.length < 2) return;
    const job = ++routeJob.current;
    setResult({ ...result, days: split.map((d) => d.plan), dayIndex: 0 });
    setRefreshing(true);
    const repriced = await Promise.all(split.map((d) => refreshLegs(settings, d.plan, chosen, d.freshLegIndexes)));
    if (job !== routeJob.current) return;
    if (repriced.some((p) => p === null)) {
      router.replace("/login");
      return;
    }
    setResult((current) => (current && current.days ? { ...current, days: repriced as RoutePlan[] } : current));
    setRefreshing(false);
  }

  /** 나눈 일정을 하나로 되돌린다 (전체 동선은 그대로 남아 있다) */
  function handleMerge() {
    routeJob.current += 1;
    setRefreshing(false);
    setResult((current) => (current ? { ...current, days: null, dayIndex: 0 } : current));
  }

  function handleSelectDay(index: number) {
    setResult((current) => (current && current.days && index >= 0 && index < current.days.length ? { ...current, dayIndex: index } : current));
  }

  function handleError(e: unknown) {
    if (e instanceof GeocodeRequestError && e.unauthorized) {
      router.replace("/login");
      return;
    }
    const message = e instanceof Error ? e.message : "위치를 찾는 중 문제가 생겼어요.";
    setLookup((l) => ({ ...l, working: false, error: message }));
  }

  // 새 파일: 합친 주소를 모두 좌표로 바꿔 필지를 만든다
  async function findLocations(merged: MergedAddress[]) {
    setParcels([]);
    setRecords({});
    setSavedSnapshot(snapshotRecords({}));
    setPickingId(null);
    setPickNotice("");
    setSelectedIds([]);
    setSelectNotice("");
    clearResult();
    setLookup({ working: true, done: 0, total: merged.length, error: "" });
    try {
      const results = await geocodeAddresses(
        merged.map((m) => m.address),
        (done, total) => setLookup((l) => ({ ...l, done, total })),
      );
      setParcels(buildParcels(merged, results));
      setLookup({ working: false, done: merged.length, total: merged.length, error: "" });
    } catch (e) {
      handleError(e);
    }
  }

  // 일시 오류로 못 찾은 필지만 다시 찾는다 (이미 위치가 있는 필지는 건드리지 않음)
  async function retryFailed() {
    const failed = parcels.filter((p) => p.lookupFailed);
    if (failed.length === 0) return;
    setLookup({ working: true, done: 0, total: failed.length, error: "" });
    try {
      const results = await geocodeAddresses(
        failed.map((p) => p.address),
        (done, total) => setLookup((l) => ({ ...l, done, total })),
      );
      setParcels((current) => applyRetryResults(current, results));
      setLookup({ working: false, done: failed.length, total: failed.length, error: "" });
    } catch (e) {
      handleError(e);
    }
  }

  // 목록 체크박스나 지도 마커로 필지를 선택·해제한다 (위치 찍는 중에는 마커 클릭을 무시)
  function handleToggle(id: string) {
    if (pickingId) return;
    const result = toggleSelection(selectedIds, id, parcels);
    setSelectedIds(result.selected);
    setSelectNotice(result.blocked ? BLOCKED_MESSAGES[result.blocked] : "");
    clearResult();
  }

  function handleSelectAll() {
    const { selected, truncated } = selectFirst(parcels);
    setSelectedIds(selected);
    setSelectNotice(truncated ? `${selected.length}개까지만 선택했어요. 한 동선에는 30필지까지 넣을 수 있어요.` : "");
    clearResult();
  }

  // ── 필지 묶음 (nice 2): 이 컴퓨터의 브라우저에만 저장, 주소와 좌표만 ──
  /** 새 목록으로 저장하고 화면에 반영한다. 저장소를 쓸 수 없으면 화면에서만 유지된다고 알린다. */
  function commitGroups(next: ParcelGroup[], message: string) {
    setGroups(next);
    setGroupNotice(saveGroups(next) ? message : `${message} (다만 이 브라우저가 저장을 막아서 창을 닫으면 사라져요.)`);
  }

  function handleSaveGroup(name: string): boolean {
    const chosen = parcels.filter((p) => selectedIds.includes(p.id));
    const r = addGroup(groups, name, chosen);
    if (!r.ok) {
      setGroupNotice(r.message);
      return false;
    }
    commitGroups(r.groups, `'${r.groups[r.groups.length - 1].name}' 묶음을 저장했어요.`);
    return true;
  }

  function handleRenameGroup(id: string, name: string): boolean {
    const r = renameGroup(groups, id, name);
    if (!r.ok) {
      setGroupNotice(r.message);
      return false;
    }
    commitGroups(r.groups, "이름을 바꿨어요.");
    return true;
  }

  function handleDeleteGroup(id: string) {
    commitGroups(deleteGroup(groups, id), "묶음을 지웠어요.");
  }

  function handleLoadGroup(id: string) {
    const group = groups.find((g) => g.id === id);
    if (!group || pickingId) return;
    const r = applyGroup(parcels, group);
    setParcels(r.parcels);
    setSelectedIds(r.selectedIds);
    setSelectNotice("");
    clearResult();
    setGroupNotice(
      `'${group.name}' 묶음의 ${r.selectedIds.length}곳을 골랐어요.` + (r.added > 0 ? ` (올린 목록에 없던 ${r.added}곳은 저장된 위치로 더했어요.)` : ""),
    );
  }

  function handleClearSelection() {
    setSelectedIds([]);
    setSelectNotice("");
    clearResult();
  }

  function startPicking(id: string) {
    setPickNotice("");
    setPickingId(id);
  }

  // 지도를 클릭하면 찍는 중인 필지(또는 출발지)의 위치로 정한다
  function handleMapPick(coord: Coord) {
    if (!pickingId) return;
    if (!isInKorea(coord)) {
      setPickNotice("대한민국 안의 위치를 찍어 주세요.");
      return;
    }
    if (pickingId === ORIGIN_PICK) {
      setOrigin((o) => ({ ...o, coord, status: "found", message: "" }));
    } else {
      setParcels((current) => setManualLocation(current, pickingId, coord));
    }
    clearResult(); // 위치가 바뀌었으니 이전 결과는 맞지 않는다
    setPickingId(null);
    setPickNotice("위치를 정했어요.");
  }

  // 출발지 주소를 바꾸면 이전에 정한 위치는 무효가 된다
  function handleOriginAddressChange(address: string) {
    setOrigin({ address, coord: null, status: "idle", message: "" });
    clearResult();
  }

  async function findOrigin() {
    const address = origin.address.trim();
    if (address === "") return;
    setOrigin((o) => ({ ...o, status: "searching", message: "" }));
    try {
      const [result] = await geocodeAddresses([address]);
      if (result?.status === "found" && result.coord) {
        setOrigin((o) => ({ ...o, coord: result.coord ?? null, status: "found", message: "" }));
      } else if (result?.status === "notFound") {
        setOrigin((o) => ({
          ...o,
          coord: null,
          status: "notFound",
          message: "출발지 위치를 찾지 못했어요. 주소를 확인하거나 지도에서 직접 찍어 주세요.",
        }));
      } else {
        setOrigin((o) => ({ ...o, coord: null, status: "error", message: "일시적인 오류예요. 잠시 뒤 다시 눌러 주세요." }));
      }
    } catch (e) {
      if (e instanceof GeocodeRequestError && e.unauthorized) {
        router.replace("/login");
        return;
      }
      setOrigin((o) => ({
        ...o,
        coord: null,
        status: "error",
        message: e instanceof Error ? e.message : "위치를 찾는 중 문제가 생겼어요.",
      }));
    }
  }

  return (
    <div className="print-root flex h-screen flex-col">
      <header className="hdr-card no-print flex items-center justify-between gap-4 px-5 py-3 md:px-8">
        <div>
          <h1 className="brand">실태조사 길잡이</h1>
          <p className="brand-sub mt-1">국유재산 실태조사 · 방문 순서를 가장 짧게</p>
        </div>
        <LogoutButton />
      </header>

      <div className="no-print flex min-h-0 flex-1 flex-col gap-3 pt-3 md:flex-row">
        <aside className="w-full overflow-y-auto p-4 pl-6 md:w-[26rem]">
          <section aria-labelledby="sec-upload" className="mb-6">
            <h2 id="sec-upload" className="mb-2 font-semibold">① 목록 올리기</h2>
            <UploadPanel onLoaded={findLocations} disabled={lookup.working} />
            {lookup.working && (
              <p className="mt-2 text-sm" aria-live="polite">
                위치 찾는 중… {lookup.done}/{lookup.total}
              </p>
            )}
            {lookup.error && (
              <p role="alert" className="mt-2 text-sm text-red-600">{lookup.error}</p>
            )}
          </section>

          <section aria-labelledby="sec-pick" className="mb-6">
            <h2 id="sec-pick" className="mb-2 font-semibold">② 필지 고르기</h2>
            <ParcelList
              parcels={parcels}
              selectedIds={selectedIds}
              notice={selectNotice}
              onToggle={handleToggle}
              onSelectAll={handleSelectAll}
              onClearSelection={handleClearSelection}
              onRepick={startPicking}
              pickingId={pickingId}
            />
            <NeedsCheckList
              parcels={parcels}
              onRetry={retryFailed}
              onPick={startPicking}
              pickingId={pickingId}
              busy={lookup.working}
            />
            {pickNotice && !pickingId && (
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-400" aria-live="polite">{pickNotice}</p>
            )}
            <GroupPanel
              groups={groups}
              selectedCount={selectedIds.length}
              notice={groupNotice}
              onSave={handleSaveGroup}
              onLoad={handleLoadGroup}
              onRename={handleRenameGroup}
              onDelete={handleDeleteGroup}
            />
          </section>

          <section aria-labelledby="sec-settings">
            <h2 id="sec-settings" className="mb-2 font-semibold">③ 동선 설정</h2>
            <RouteSettingsForm
              origin={origin}
              onOriginAddressChange={handleOriginAddressChange}
              onFindOrigin={findOrigin}
              onPickOrigin={() => startPicking(ORIGIN_PICK)}
              pickingOrigin={pickingOrigin}
              places={places}
              placeNotice={placeNotice}
              onSelectPlace={selectPlace}
              onSaveFavorite={saveFavorite}
              onRemoveFavorite={(id) => updatePlaces({ ...places, favorites: removeFavorite(places.favorites, id) })}
              onRemoveRecent={(p) => updatePlaces({ ...places, recents: removeRecent(places.recents, p.coord) })}
              onClearPlaces={() => updatePlaces(EMPTY_PLACES)}
              selectedCount={selectedIds.length}
              busy={routing}
              onSubmit={makeRoute}
              onChange={() => setSettingsChanged(true)}
            />
          </section>
        </aside>

        <main className="panel-map relative min-h-[36vh] flex-1">
          <KakaoMap
            parcels={parcels}
            origin={origin.coord}
            route={drawing}
            routeColor={result ? ROUTE_COLORS[result.settings.mode] : ROUTE_COLORS.car}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            picking={!!pickingId}
            onPick={handleMapPick}
          />
          {drawing && drawing.segments.length > 0 && result && (
            <div className="absolute bottom-6 left-3 z-10 rounded bg-white/90 px-3 py-2 text-xs text-zinc-800 shadow dark:bg-zinc-900/90 dark:text-zinc-100">
              <p className="mb-1 font-semibold">경로 (순서대로 직선 연결)</p>
              <p className="flex items-center gap-2">
                <span className="inline-block w-8 border-t-4" style={{ borderColor: ROUTE_COLORS[result.settings.mode] }} />
                길찾기 결과로 계산한 구간
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block w-8 border-t-4 border-dashed opacity-60" style={{ borderColor: ROUTE_COLORS[result.settings.mode] }} />
                추정값 구간
              </p>
              <p className="mt-1 text-zinc-500">마커의 숫자는 방문 순서예요. 빨간 마커는 출발지예요.</p>
            </div>
          )}
          {pickingId && (
            <div
              role="status"
              className="absolute left-1/2 top-3 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg"
            >
              <span>
                <strong>{pickingOrigin ? "출발지" : pickingParcel?.address}</strong>의 위치를 지도에서 눌러 주세요.
                {pickNotice && <span className="ml-2 text-amber-300">{pickNotice}</span>}
              </span>
              <button
                type="button"
                onClick={() => setPickingId(null)}
                className="shrink-0 rounded border border-white/60 px-2 py-0.5"
              >
                취소
              </button>
            </div>
          )}
        </main>
      </div>

      <section aria-labelledby="sec-result" className="print-area panel-result mt-3 max-h-[40vh] overflow-y-auto p-5">
        <h2 id="sec-result" className="mb-2 font-semibold">④ 결과</h2>
        {routing ? (
          <p className="text-sm" aria-live="polite">길을 찾아 가장 짧은 순서를 계산하는 중이에요…</p>
        ) : result ? (
          <ResultPanel settings={viewSettings ?? result.settings} plan={viewPlan ?? result.plan} parcels={result.parcels}
            days={result.days ? { plans: result.days, index: result.dayIndex, startDate: result.settings.date, fullCount: result.plan.orderIds.length } : null}
            fullCount={result.plan.orderIds.length}
            onSplit={handleSplit}
            onMerge={handleMerge}
            onSelectDay={handleSelectDay}
            weather={weather}
            stale={settingsChanged}
            excluded={result.excluded}
            notice={result.notice}
            records={records}
            onRecordChange={handleRecordChange}
            onDownloaded={(saved) => setSavedSnapshot(snapshotRecords(saved))}
            unsaved={unsaved}
            onMove={handleMove}
            refreshing={refreshing}
          />
        ) : (
          <p className="text-sm text-zinc-500">동선 결과 요약과 순서표가 들어올 자리예요.</p>
        )}
      </section>
    </div>
  );
}
