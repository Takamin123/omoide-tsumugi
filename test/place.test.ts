// 写真の位置から市区町村の名前を引く（外のサービスを使わない）。0047
// 座標は架空の写真のためのもの（市役所などの公開の代表点の近く、海の上、外国）。実際の家族の位置は使わない。
import { describe, expect, it } from "vitest";
import { nearestPlace, PLACE_MAX_DISTANCE_KM, placeName } from "../src/server/core/place";
import { PLACES_TSV, PREFECTURES } from "../src/server/core/places-data";
import { fs, path, repoRoot } from "./node";

describe("placeName", () => {
  it.each([
    [34.49, 136.71, "三重県伊勢市"],
    [31.6, 130.56, "鹿児島県鹿児島市"],
    [35.65, 139.65, "東京都世田谷区"], // 東京の区は区の名前
    [35.46, 139.6, "神奈川県横浜市"], // 政令市は区を付けず市まで（引くのは区の代表点）
    [26.21, 127.68, "沖縄県那覇市"],
    [45.42, 141.67, "北海道稚内市"],
    [24.47, 123.0, "沖縄県与那国町"],
  ])("(%f, %f) → %s", (lat, lng, name) => {
    expect(placeName(lat, lng)).toBe(name);
  });

  it.each([
    ["位置がない", null, null],
    ["緯度だけ", 34.49, null],
    ["ソウル（日本の外）", 37.57, 126.98],
    ["釜山（対馬に近い日本の外）", 35.1, 129.04],
    ["太平洋の真ん中", 30.0, 160.0],
    ["0, 0", 0, 0],
    ["数でない", Number.NaN, 136.71],
  ])("%s → null", (_n, lat, lng) => {
    expect(placeName(lat as number | null, lng as number | null)).toBeNull();
  });

  it("一番近い代表点がしきい値より遠ければ出さず、内側なら出す", () => {
    // 与那国町の代表点（24.468, 123.004）から真西へ（西にほかの代表点はない）。この緯度で経度 1 度 ≒ 101.3 km
    const base = { lat: 24.468, lng: 123.004 };
    const west = (km: number) => base.lng - km / 101.3;
    expect(nearestPlace(base.lat, west(PLACE_MAX_DISTANCE_KM - 1))!.km).toBeLessThan(PLACE_MAX_DISTANCE_KM);
    expect(placeName(base.lat, west(PLACE_MAX_DISTANCE_KM - 1))).toBe("沖縄県与那国町");
    expect(nearestPlace(base.lat, west(PLACE_MAX_DISTANCE_KM + 1))!.km).toBeGreaterThan(PLACE_MAX_DISTANCE_KM);
    expect(placeName(base.lat, west(PLACE_MAX_DISTANCE_KM + 1))).toBeNull();
  });

  it("一覧の形: 47 都道府県、各行が 5 つの欄で、代表点が日本の範囲にある", () => {
    expect(PREFECTURES).toHaveLength(47);
    const rows = PLACES_TSV.split("\n");
    expect(rows.length).toBeGreaterThan(1700);
    for (const row of rows) {
      const [pi, city, , lat, lng] = row.split("|");
      expect(PREFECTURES[Number(pi)]).toBeDefined();
      expect(city).toBeTruthy();
      expect(Number(lat) / 1000).toBeGreaterThan(20);
      expect(Number(lat) / 1000).toBeLessThan(46);
      expect(Number(lng) / 1000).toBeGreaterThan(122);
      expect(Number(lng) / 1000).toBeLessThan(154);
    }
  });
});

describe("地名は画面に出すためだけに使う（Claude に渡さない。0017、0021、0047）", () => {
  it("core/place を読み込むのは、API の形に変える routes/views.ts だけ", () => {
    const serverDir = path.join(repoRoot, "src/server");
    const importers = (fs.readdirSync(serverDir, { recursive: true }) as string[])
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /from\s+["'][^"']*\/place(?:\.js)?["']/.test(fs.readFileSync(path.join(serverDir, f), "utf8")))
      .map((f) => f.split(path.sep).join("/"));
    expect(importers).toEqual(["routes/views.ts"]);
  });
});
