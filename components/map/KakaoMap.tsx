"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { RouteDrawing } from "@/lib/core/route";
import type { Coord, Parcel } from "@/lib/core/types";

// 카카오 지도 SDK의 필요한 부분만 최소로 선언 (전체 타입 패키지는 쓰지 않음)
type KakaoLatLng = unknown;
type KakaoMapInstance = {
  setBounds: (bounds: unknown) => void;
  setCenter: (latlng: KakaoLatLng) => void;
  setLevel: (level: number) => void;
  setMapTypeId: (id: unknown) => void;
};
type KakaoMarkerImage = unknown;
type KakaoMarker = { setMap: (map: KakaoMapInstance | null) => void; setImage: (image: KakaoMarkerImage) => void };
type KakaoPolyline = { setMap: (map: KakaoMapInstance | null) => void };
type KakaoClickHandler = (e: { latLng: { getLat: () => number; getLng: () => number } }) => void;
type KakaoMapsApi = {
  load: (cb: () => void) => void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (el: HTMLElement, opts: { center: KakaoLatLng; level: number }) => KakaoMapInstance;
  Marker: new (opts: { position: KakaoLatLng; title?: string; image?: KakaoMarkerImage }) => KakaoMarker;
  MarkerImage: new (src: string, size: unknown, opts?: { offset?: unknown }) => KakaoMarkerImage;
  MapTypeId: { ROADMAP: unknown; HYBRID: unknown };
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  LatLngBounds: new () => { extend: (latlng: KakaoLatLng) => void };
  Polyline: new (opts: {
    path: KakaoLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
  }) => KakaoPolyline;
  event: {
    addListener: (target: unknown, type: string, handler: KakaoClickHandler | (() => void)) => void;
    removeListener: (target: unknown, type: string, handler: KakaoClickHandler | (() => void)) => void;
  };
};
declare global {
  interface Window {
    kakao?: { maps: KakaoMapsApi };
  }
}

// 서울시청 근처를 기본 중심으로
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };

/** 마커 그림: 선택 안 됨(파랑) / 선택됨(초록 + 체크). 그림 파일 없이 SVG로 직접 만든다. */
function pinSvg(color: string, checked: boolean): string {
  const check = checked ? `<path d='M11 16l3.5 3.5L21 12.5' stroke='${color}' stroke-width='2.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/>` : "";
  const dot = checked ? "" : `<circle cx='16' cy='16' r='5' fill='white'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='40' viewBox='0 0 32 40'>` +
    `<path d='M16 1C7.7 1 1 7.7 1 16c0 10.5 15 23 15 23s15-12.5 15-23C31 7.7 24.3 1 16 1z' fill='${color}' stroke='white' stroke-width='1.5'/>` +
    `<circle cx='16' cy='16' r='9' fill='${checked ? "white" : "none"}'/>${dot}${check}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 출발지 마커: 빨강 + 흰 네모 (필지 마커와 구별) */
function originSvg(): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='40' viewBox='0 0 32 40'>` +
    `<path d='M16 1C7.7 1 1 7.7 1 16c0 10.5 15 23 15 23s15-12.5 15-23C31 7.7 24.3 1 16 1z' fill='#dc2626' stroke='white' stroke-width='1.5'/>` +
    `<rect x='10' y='10' width='12' height='12' rx='2' fill='white'/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 방문 순번이 적힌 마커 그림 (순번이 두 자리면 글자를 조금 줄인다) */
function numberedSvg(n: number, color: string): string {
  const size = n >= 10 ? 12 : 15;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='40' viewBox='0 0 32 40'>` +
    `<path d='M16 1C7.7 1 1 7.7 1 16c0 10.5 15 23 15 23s15-12.5 15-23C31 7.7 24.3 1 16 1z' fill='${color}' stroke='white' stroke-width='1.5'/>` +
    `<text x='16' y='${n >= 10 ? 21 : 22}' font-size='${size}' font-weight='700' text-anchor='middle' fill='white' font-family='Arial, sans-serif'>${n}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 경로선과 번호 마커 색: 이동 수단마다 다르게 */
export const ROUTE_COLORS = { car: "#2563eb", transit: "#16a34a", walk: "#ea580c" } as const;

// Design Ref: §3.3 지도 — 위치를 찾은 필지를 마커로 표시한다. 마커를 누르면 선택·해제, 찍기 모드에서는 지도 클릭 위치를 알려 준다.
// 동선 결과가 있으면 방문 순서대로 번호 마커와 경로선(실제 길찾기 구간은 실선, 추정값 구간은 점선)을 그린다.
export default function KakaoMap({
  parcels,
  origin,
  route,
  routeColor,
  selectedIds,
  onToggle,
  picking,
  onPick,
}: {
  parcels: Parcel[];
  /** 출발지 위치 (정해졌을 때만 빨간 마커로 표시) */
  origin: Coord | null;
  /** 동선 결과 (있으면 번호 마커와 경로선을 그린다) */
  route: RouteDrawing | null;
  /** 경로선과 번호 마커 색 */
  routeColor: string;
  selectedIds: string[];
  /** 마커를 눌렀을 때 (동선에 넣을 필지 선택·해제) */
  onToggle: (id: string) => void;
  /** true이면 지도를 클릭한 위치를 onPick으로 알려 준다 ("확인 필요" 필지의 위치 직접 찍기) */
  picking: boolean;
  onPick: (coord: Coord) => void;
}) {
  const jsKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const markersRef = useRef<Map<string, KakaoMarker>>(new Map());
  const originMarkerRef = useRef<KakaoMarker | null>(null);
  const linesRef = useRef<KakaoPolyline[]>([]);
  const numberImagesRef = useRef<Map<string, KakaoMarkerImage>>(new Map());
  const routeRef = useRef<{ order: Record<string, number>; color: string } | null>(null);
  const imagesRef = useRef<{ off: KakaoMarkerImage; on: KakaoMarkerImage; origin: KakaoMarkerImage } | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState("");
  const [skyview, setSkyview] = useState(false);

  // 일반 지도 ↔ 스카이뷰(위성 사진 + 지명) 전환
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!mapReady || !kakao || !map) return;
    map.setMapTypeId(skyview ? kakao.maps.MapTypeId.HYBRID : kakao.maps.MapTypeId.ROADMAP);
  }, [mapReady, skyview]);

  // 최신 값을 이벤트 처리 함수에서 쓰기 위한 보관함
  const onPickRef = useRef(onPick);
  const onToggleRef = useRef(onToggle);
  const selectedRef = useRef(new Set(selectedIds));
  useEffect(() => {
    onPickRef.current = onPick;
    onToggleRef.current = onToggle;
  }, [onPick, onToggle]);

  // 지도 만들기
  useEffect(() => {
    if (!sdkLoaded || !ref.current || !window.kakao) return;
    window.kakao.maps.load(() => {
      const { kakao } = window;
      if (!kakao || !ref.current || mapRef.current) return;
      const size = new kakao.maps.Size(32, 40);
      const opts = { offset: new kakao.maps.Point(16, 40) };
      imagesRef.current = {
        off: new kakao.maps.MarkerImage(pinSvg("#2563eb", false), size, opts),
        on: new kakao.maps.MarkerImage(pinSvg("#16a34a", true), size, opts),
        origin: new kakao.maps.MarkerImage(originSvg(), size, opts),
      };
      mapRef.current = new kakao.maps.Map(ref.current, {
        center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        level: 7,
      });
      setMapReady(true);
    });
  }, [sdkLoaded]);

  /** 필지 마커 그림: 동선에 들어 있으면 방문 순번, 아니면 선택 여부에 따라 */
  function imageFor(id: string): KakaoMarkerImage | null {
    const kakao = window.kakao;
    const images = imagesRef.current;
    if (!kakao || !images) return null;
    const r = routeRef.current;
    const n = r?.order[id];
    if (r && n !== undefined) {
      const key = `${r.color}:${n}`;
      let image = numberImagesRef.current.get(key);
      if (!image) {
        image = new kakao.maps.MarkerImage(numberedSvg(n, r.color), new kakao.maps.Size(32, 40), { offset: new kakao.maps.Point(16, 40) });
        numberImagesRef.current.set(key, image);
      }
      return image;
    }
    return selectedRef.current.has(id) ? images.on : images.off;
  }

  // 필지·출발지가 바뀔 때마다 마커를 다시 그리고, 모든 마커가 한눈에 보이게 지도를 맞춘다
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    const images = imagesRef.current;
    if (!mapReady || !kakao || !map || !images) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = new Map();
    originMarkerRef.current?.setMap(null);
    originMarkerRef.current = null;

    const located = parcels.filter((p) => p.coord);
    const total = located.length + (origin ? 1 : 0);
    if (total === 0) return;

    const bounds = new kakao.maps.LatLngBounds();
    if (origin) {
      const position = new kakao.maps.LatLng(origin.lat, origin.lng);
      const marker = new kakao.maps.Marker({ position, title: "출발지", image: images.origin });
      marker.setMap(map);
      originMarkerRef.current = marker;
      bounds.extend(position);
      if (total === 1) {
        // 마커가 하나뿐이면 너무 확대되지 않게 중심과 크기를 직접 정한다
        map.setCenter(position);
        map.setLevel(4);
      }
    }
    for (const p of located) {
      const position = new kakao.maps.LatLng(p.coord!.lat, p.coord!.lng);
      const marker = new kakao.maps.Marker({
        position,
        title: p.address,
        image: imageFor(p.id) ?? images.off,
      });
      marker.setMap(map);
      kakao.maps.event.addListener(marker, "click", () => onToggleRef.current(p.id));
      markersRef.current.set(p.id, marker);
      bounds.extend(position);
    }
    if (total > 1) map.setBounds(bounds);
  }, [mapReady, parcels, origin]);

  // 선택이나 동선 결과가 바뀌면 마커 그림만 바꾼다 (지도 위치는 그대로)
  useEffect(() => {
    selectedRef.current = new Set(selectedIds);
    routeRef.current = route ? { order: route.order, color: routeColor } : null;
    if (!mapReady) return;
    markersRef.current.forEach((marker, id) => {
      const image = imageFor(id);
      if (image) marker.setImage(image);
    });
  }, [mapReady, selectedIds, route, routeColor]);

  // 동선 결과가 있으면 경로선을 그리고 경로 전체가 보이게 지도를 맞춘다
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!mapReady || !kakao || !map) return;

    linesRef.current.forEach((l) => l.setMap(null));
    linesRef.current = [];
    if (!route || route.segments.length === 0) return;

    for (const seg of route.segments) {
      const line = new kakao.maps.Polyline({
        path: [new kakao.maps.LatLng(seg.from.lat, seg.from.lng), new kakao.maps.LatLng(seg.to.lat, seg.to.lng)],
        strokeWeight: 5,
        strokeColor: routeColor,
        strokeOpacity: seg.estimated ? 0.6 : 0.9,
        strokeStyle: seg.estimated ? "shortdash" : "solid",
      });
      line.setMap(map);
      linesRef.current.push(line);
    }

    const bounds = new kakao.maps.LatLngBounds();
    route.points.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
    map.setBounds(bounds);
  }, [mapReady, route, routeColor]);

  // 찍기 모드: 지도를 클릭한 위치를 알려 준다
  useEffect(() => {
    const kakao = window.kakao;
    const map = mapRef.current;
    const el = ref.current;
    if (!mapReady || !picking || !kakao || !map || !el) return;

    const handler: KakaoClickHandler = (e) => onPickRef.current({ lat: e.latLng.getLat(), lng: e.latLng.getLng() });
    kakao.maps.event.addListener(map, "click", handler);
    el.style.cursor = "crosshair";
    return () => {
      kakao.maps.event.removeListener(map, "click", handler);
      el.style.cursor = "";
    };
  }, [mapReady, picking]);

  if (!jsKey) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
        지도 표시용 키(NEXT_PUBLIC_KAKAO_JS_KEY)가 아직 설정되지 않았어요.
        <br />
        .env에 키를 넣고 개발 서버를 다시 시작해 주세요.
      </div>
    );
  }

  return (
    <>
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false`}
        strategy="afterInteractive"
        onLoad={() => setSdkLoaded(true)}
        onError={() => setError("지도를 불러오지 못했어요. 인터넷 연결과 카카오 사이트 주소 설정을 확인해 주세요.")}
      />
      {error ? (
        <div role="alert" className="flex h-full items-center justify-center p-6 text-sm text-red-600">{error}</div>
      ) : (
        <div className="relative h-full w-full">
          <div ref={ref} className="h-full w-full" aria-label="지도" />
          <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded border border-zinc-300 bg-white text-xs shadow">
            {([false, true] as const).map((isSky) => (
              <button
                key={String(isSky)}
                type="button"
                onClick={() => setSkyview(isSky)}
                aria-pressed={skyview === isSky}
                className={`px-3 py-1.5 ${skyview === isSky ? "bg-blue-600 text-white" : "text-zinc-800"}`}
              >
                {isSky ? "스카이뷰" : "지도"}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
