// 写真の位置（小数第 2 位に丸めた緯度経度）から、一番近い市区町村の名前を引く。外のサービスは使わない。0047
// 一覧は places-data.ts（scripts/build-places.mjs が作る）。引いた地名は画面に出すだけ: Claude に渡さず、ログにも出さない。
import { PLACES_TSV, PREFECTURES } from "./places-data";

/** 一番近い代表点がこれより遠ければ、日本の外か、どこと言えない所として出さない（km） */
export const PLACE_MAX_DISTANCE_KM = 30;

type Place = { pref: string; city: string; ward: string; lat: number; lng: number };

let places: Place[] | null = null;
/** 一覧は最初に引くときに一度だけ読む */
function load(): Place[] {
  if (places) return places;
  places = PLACES_TSV.split("\n").map((line) => {
    const [pi, city, ward, lat, lng] = line.split("|");
    return { pref: PREFECTURES[Number(pi)]!, city: city!, ward: ward!, lat: Number(lat) / 1000, lng: Number(lng) / 1000 };
  });
  return places;
}

const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

/** 二点の間の距離（km）。30 km 程度の比べにしか使わないので、平面に近づけた式で足りる */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const x = (lng2 - lng1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  const y = (lat2 - lat1) * RAD;
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_KM;
}

/** 一番近い代表点と、その距離。一覧が空なら null */
export function nearestPlace(lat: number, lng: number): { place: Omit<Place, "lat" | "lng">; km: number } | null {
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of load()) {
    const km = distanceKm(lat, lng, p.lat, p.lng);
    if (km < bestKm) {
      best = p;
      bestKm = km;
    }
  }
  return best ? { place: { pref: best.pref, city: best.city, ward: best.ward }, km: bestKm } : null;
}

/**
 * 写真の場所の名前（「三重県伊勢市」）。画面では「あたり」を付けて出す（言葉はクライアントの words.ts）。
 * 位置がない、一番近い代表点が遠すぎる（日本の外など）ときは null。政令市は区を付けず市まで（代表点は区ごとの点で引く）
 */
export function placeName(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const found = nearestPlace(lat, lng);
  if (!found || found.km > PLACE_MAX_DISTANCE_KM) return null;
  return `${found.place.pref}${found.place.city}`;
}
