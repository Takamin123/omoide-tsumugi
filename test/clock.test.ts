import { describe, expect, it } from "vitest";
import { addDays, canAdvanceClock, familyClock, jstDate, jstSlot, nextClock } from "../src/server/core/clock";
import { pickFixedPhoto } from "../src/server/core/entrances";
import type { PhotoRow } from "../src/server/core/ports";

describe("日本時間", () => {
  it.each([
    ["2026-11-01T14:59:59Z", "2026-11-01", "night"],
    ["2026-11-01T15:00:00Z", "2026-11-02", "morning"], // 0:00
    ["2026-11-02T01:59:59Z", "2026-11-02", "morning"], // 10:59
    ["2026-11-02T02:00:00Z", "2026-11-02", "noon"], // 11:00
    ["2026-11-02T07:59:59Z", "2026-11-02", "noon"], // 16:59
    ["2026-11-02T08:00:00Z", "2026-11-02", "night"], // 17:00
  ])("%s → %s %s", (iso, date, slot) => {
    expect(jstDate(new Date(iso))).toBe(date);
    expect(jstSlot(new Date(iso))).toBe(slot);
  });

  it("時計を持つ家族は時計、持たない家族は今の日本時間", () => {
    const now = new Date("2026-11-02T00:00:00Z");
    expect(familyClock({ clock: { date: "2030-01-01", slot: "night" } }, now)).toEqual({ date: "2030-01-01", slot: "night" });
    expect(familyClock({ clock: null }, now)).toEqual({ date: "2026-11-02", slot: "morning" });
  });

  it("夜の次は翌日の朝（月・年をまたぐ）", () => {
    expect(nextClock({ date: "2026-12-31", slot: "night" })).toEqual({ date: "2027-01-01", slot: "morning" });
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("時計を使える家族（判断はここ一か所）", () => {
  it.each([
    ["production", false, false],
    ["production", true, true],
    ["preview", false, true],
    ["development", false, true],
  ])("APP_ENV=%s isDemo=%s → %s", (appEnv, isDemo, expected) => {
    expect(canAdvanceClock({ appEnv }, { isDemo })).toBe(expected);
  });
});

describe("固定の入り口の写真", () => {
  const photo = (id: string, owner: string, takenAt: string | null, createdAt = 0): PhotoRow => ({
    id, familyId: "f", ownerMemberId: owner, storageKey: "", contentHash: "", width: 1, height: 1, takenAt, latitude: null, longitude: null, createdAt,
  });
  const ps = [photo("own", "me", "1950-01-01T00:00:00"), photo("x", "other", null), photo("y", "other", "1990-01-01T00:00:00"), photo("z", "other", "1980-01-01T00:00:00")];

  it("ほかの人の、まだ使っていない、撮影日の古いもの。撮影日がないものは後ろ", () => {
    expect(pickFixedPhoto(ps, [], "me")?.id).toBe("z");
    expect(pickFixedPhoto(ps, [{ photoId: "z", forDate: "2026-01-01" }, { photoId: "y", forDate: "2026-01-02" }], "me")?.id).toBe("x");
  });
  it("ほかの人のものを使い切ったら、自分のもの", () => {
    const used = ["x", "y", "z"].map((photoId, i) => ({ photoId, forDate: `2026-01-0${i + 1}` }));
    expect(pickFixedPhoto(ps, used, "me")?.id).toBe("own");
  });
  it("すべて使ったら、最後に出したのがいちばん古いもの", () => {
    const used = [
      { photoId: "own", forDate: "2026-01-04" },
      { photoId: "x", forDate: "2026-01-02" },
      { photoId: "y", forDate: "2026-01-03" },
      { photoId: "z", forDate: "2026-01-01" },
      { photoId: "z", forDate: "2026-01-05" },
    ];
    expect(pickFixedPhoto(ps, used, "me")?.id).toBe("x");
  });
  it("写真がなければ null", () => {
    expect(pickFixedPhoto([], [], "me")).toBeNull();
  });
});
