// デモの家族（架空の山形の三世代）の種。台本は人間が承認したもの（2026-11-03）。文を変えない。0038
// - 人は呼ばれ方で指す。家族の人の呼ばれ方と role が種と一致しないとき、初期化は何も変えずに止める
// - 写真と録音のファイルはリポジトリに入れない。R2 の demo/seed/ に置き、初期化のたびに families/<id>/ に写す
// - 撮影日は EXIF に頼らず種で持つ（種のファイルは EXIF を消してある）。場所も種で持つ: 実際の撮影場所は使わず（家の位置を漏らさない）、
//   台本の筋に合う公開の市区町村の代表点（places-data.ts の点を小数第 2 位に丸めた架空の位置）を入れる。0038、0047
// - 日は「asOfDate（初期化した日。日本時間）の何日前」、時刻は日本時間の HH:MM。語りはその日の入り口の後
// - 写真の説明（photo_guesses）と記録（records）は種に入れない。初期化の最後の毎朝の処理が作る
// - 声の語りの transcript は台本そのまま。整えた文字は本物の Haiku を一度呼んだ結果（seed-cleaned.ts）を写す
import type { MemberRow } from "../core/ports";

export type SeedCalledAs = "じいちゃん" | "お母さん" | "まさとおじさん" | "ゆい";

export interface SeedMember {
  calledAs: SeedCalledAs;
  role: MemberRow["role"];
}

export interface SeedPhoto {
  label: string;
  /** R2 の demo/seed/photos/ の下のファイル名 */
  file: string;
  owner: SeedCalledAs;
  /** 撮影日（台本の表の日時。日本時間とみなした YYYY-MM-DDTHH:mm:ss） */
  takenAt: string;
  /**
   * 場所（小数第 2 位に丸めた緯度経度。0010）。実際の撮影場所ではなく、台本の筋に合う市区町村の公開の代表点（架空）。
   * 伊勢・二見の旅は三重県伊勢市、山形の家の近くは最上川の舟運の河岸の町・大石田町。0038、0047
   */
  latitude: number;
  longitude: number;
  /** 種のファイル（向きを直し、長い辺 1600px、EXIF なし）の SHA-256 と大きさ */
  contentHash: string;
  width: number;
  height: number;
}

export interface SeedEntrance {
  label: string;
  member: SeedCalledAs;
  photo: string;
  daysAgo: number;
  /** 作った時刻（毎朝の処理の時刻）と、見せた時刻 */
  createdAt: string;
  shownAt: string;
  /** 添える家族の言葉: 語りの印と、その語りの中の引用の文字（位置は初期化のときに quoteSource の中で探す） */
  quote: { narration: string; text: string };
}

export interface SeedNarration {
  label: string;
  photo: string;
  speaker: SeedCalledAs;
  kind: "voice" | "text";
  text: string;
  daysAgo: number;
  at: string;
  entrance?: string;
  replyTo?: string;
}

export const DEMO_SEED_PREFIX = "demo/seed/";
export const seedPhotoKey = (p: Pick<SeedPhoto, "file">) => `${DEMO_SEED_PREFIX}photos/${p.file}`;
export const seedVoiceKey = (n: Pick<SeedNarration, "label">) => `${DEMO_SEED_PREFIX}voice/${n.label}`;

/**
 * 声の録音の長さ（ミリ秒）。録音を R2 に置くときに ffprobe で測って書く（.claude/skills/demo-reset/SKILL.md）。
 * 測るまでは null（長さを作らない）
 */
export const SEED_VOICE_DURATION_MS: Record<string, number | null> = {
  n1: 18240,
  n7: 12139,
  n8: 12308,
  n12: 8746,
};

export const SEED_MEMBERS: readonly SeedMember[] = [
  { calledAs: "じいちゃん", role: "elder" },
  { calledAs: "お母さん", role: "family" },
  { calledAs: "まさとおじさん", role: "family" },
  { calledAs: "ゆい", role: "family" },
];

/** 三重県伊勢市の代表点（34.488, 136.709）を小数第 2 位に丸めたもの。伊勢・二見の旅（P1〜P9） */
const ISE = { latitude: 34.49, longitude: 136.71 } as const;
/**
 * 山形県大石田町の代表点（38.594, 140.373）を小数第 2 位に丸めたもの。山形の家の近く（Y1〜Y3。最上川、田んぼ）。
 * 最上川の舟運の河岸として知られる町で、「若いころよく舟で渡った」（台本）に合う
 */
const OISHIDA = { latitude: 38.59, longitude: 140.37 } as const;

export const SEED_PHOTOS: readonly SeedPhoto[] = [
  { label: "P1", file: "20190503_140219.jpg", owner: "お母さん", takenAt: "2019-05-03T14:02:00", ...ISE, contentHash: "8debeec419ed0f7e16e64b3bf3b6dde05170bc60b8fef030904b240441711281", width: 1600, height: 900 },
  { label: "P2", file: "20190503_142231.jpg", owner: "お母さん", takenAt: "2019-05-03T14:22:00", ...ISE, contentHash: "f7ca7ee2e85fa5c537ca6c78810c538e091d921ddcd72419a10695f214914b4d", width: 1600, height: 900 },
  { label: "P3", file: "20190503_142416.jpg", owner: "お母さん", takenAt: "2019-05-03T14:24:00", ...ISE, contentHash: "77b99e710ac02c640daa03f9b9633937d04643206682515e9e5349c375417766", width: 1600, height: 900 },
  { label: "P4", file: "20190503_145224.jpg", owner: "お母さん", takenAt: "2019-05-03T14:52:00", ...ISE, contentHash: "144f5ddfbcd4a900d7dc667f6dd72f4c1937718752ba5cdba098986508ea619d", width: 1600, height: 900 },
  { label: "P5", file: "20190503_194446.jpg", owner: "ゆい", takenAt: "2019-05-03T19:44:00", ...ISE, contentHash: "009fa9ff61e2557f30f01382c31432a0a91a5deda8ed420944d6bc65fd63131f", width: 1600, height: 900 },
  { label: "P6", file: "20190503_195517.jpg", owner: "ゆい", takenAt: "2019-05-03T19:55:00", ...ISE, contentHash: "4373ebd97a3e31b3702734d6752ad5b18be01c8292d8d01840878cdfd1cb74b6", width: 1600, height: 900 },
  { label: "P7", file: "20190504_123300.jpg", owner: "お母さん", takenAt: "2019-05-04T12:33:00", ...ISE, contentHash: "62013e76051d41c712f8bca3a53389edbb63566ab083a2877a6e8ec6d620104d", width: 1600, height: 900 },
  { label: "P8", file: "DSC_0170.jpg", owner: "お母さん", takenAt: "2019-05-04T09:35:00", ...ISE, contentHash: "57bc608cba9f0470c0f5e348ef259cf3d1d2ff2ab31fa49a53641b05e3c145a7", width: 1600, height: 900 },
  { label: "P9", file: "20190504_152550.jpg", owner: "お母さん", takenAt: "2019-05-04T15:25:00", ...ISE, contentHash: "72b2cd64eaa10df453625a737dc8951bfd830ca86e70a661d2941934ff5e3f08", width: 900, height: 1600 },
  { label: "Y1", file: "20260625_113003.jpg", owner: "まさとおじさん", takenAt: "2026-06-25T11:30:00", ...OISHIDA, contentHash: "77011f992f6dff8c84f88b54deef82cbf441b4b2efa25e1c09b4e8be8df71a4c", width: 1600, height: 901 },
  { label: "Y2", file: "20260625_113849.jpg", owner: "まさとおじさん", takenAt: "2026-06-25T11:38:00", ...OISHIDA, contentHash: "1f36350e7a199489ab9ce77bf5b0806fa74e8893ce4be9eb04f359447a6f825a", width: 1600, height: 901 },
  { label: "Y3", file: "20260625_124417.jpg", owner: "まさとおじさん", takenAt: "2026-06-25T12:44:00", ...OISHIDA, contentHash: "00566d5a573fa13b3f8a7f5aef84cfb20c706105c588947700f3bdd03675f019", width: 1600, height: 901 },
];

/** 写真を家族が登録した日と時刻（語りの前）。持ち主ごとにまとめて登録したことにする */
export const SEED_PHOTO_REGISTERED = { daysAgo: 6, at: "20:00" } as const;

export const SEED_ENTRANCES: readonly SeedEntrance[] = [
  {
    label: "E1",
    member: "ゆい",
    photo: "P4",
    daysAgo: 3,
    createdAt: "03:00",
    shownAt: "07:50",
    quote: { narration: "n1", text: "本物は思ったより小さくてな、でも縄がぴんと張ってて、きれいだった" },
  },
  {
    label: "E2",
    member: "じいちゃん",
    photo: "P6",
    daysAgo: 2,
    createdAt: "03:00",
    shownAt: "09:00",
    quote: { narration: "n3", text: "ばあちゃんが『ゆいが先に食べな』って、自分の分まで鍋に入れてくれた" },
  },
];

export const SEED_NARRATIONS: readonly SeedNarration[] = [
  {
    label: "n1",
    photo: "P4",
    speaker: "じいちゃん",
    kind: "voice",
    daysAgo: 5,
    at: "10:20",
    text: "夫婦岩は、テレビでしか見たことなかったんだ。本物は思ったより小さくてな、でも縄がぴんと張ってて、きれいだった。ばあちゃんと並んで、うちらみたいだなって言ったら、みんなに笑われたんだよ。",
  },
  {
    label: "n2",
    photo: "P4",
    speaker: "お母さん",
    kind: "text",
    daysAgo: 5,
    at: "21:05",
    text: "二人を伊勢に連れていくのは、ずっと前からの約束だった。令和になったばかりの連休で、どこも人がいっぱいだったけど、夫婦岩の前だけは不思議と静かだった。",
  },
  {
    label: "n3",
    photo: "P6",
    speaker: "ゆい",
    kind: "text",
    daysAgo: 4,
    at: "20:30",
    text: "伊勢の宿の夜ごはん。すき焼きのお肉がすごくいいお肉で、ばあちゃんが『ゆいが先に食べな』って、自分の分まで鍋に入れてくれた。",
  },
  {
    label: "n4",
    photo: "P5",
    speaker: "ゆい",
    kind: "text",
    daysAgo: 4,
    at: "20:40",
    text: "舟盛りが出てきたとき、じいちゃんが一番に『写真撮っとけ』って言った。家族旅行でごはんの写真を撮ったのは、たぶんこれが初めて。",
  },
  {
    label: "n5",
    photo: "P4",
    speaker: "ゆい",
    kind: "text",
    daysAgo: 3,
    at: "08:10",
    entrance: "E1",
    text: "わたしは岩より、じいちゃんとばあちゃんが並んで写真を撮ってもらってるところばかり見てた。じいちゃん、あのとき帽子をとってたよね。",
  },
  {
    label: "n6",
    photo: "P4",
    speaker: "お母さん",
    kind: "text",
    daysAgo: 3,
    at: "12:15",
    replyTo: "n5",
    text: "帽子をとったのは、神様の前だからって言ってた。お父さんらしいね。",
  },
  {
    label: "n7",
    photo: "P6",
    speaker: "じいちゃん",
    kind: "voice",
    daysAgo: 2,
    at: "09:20",
    entrance: "E2",
    text: "ばあちゃんはいつもそうなんだ。孫が食べてるとこ見てるのが、一番のごちそうなんだって。山形の芋煮もうまいけど、あの肉は口の中でとけたなぁ。",
  },
  {
    label: "n8",
    photo: "Y2",
    speaker: "じいちゃん",
    kind: "voice",
    daysAgo: 2,
    at: "15:40",
    text: "最上川のこのあたりは、若いころよく舟で渡ったんだ。川の真ん中に大きな岩があってな、伊勢で夫婦岩を見たとき、あの岩を思い出したんだよ。",
  },
  {
    label: "n9",
    photo: "Y1",
    speaker: "まさとおじさん",
    kind: "text",
    daysAgo: 2,
    at: "18:30",
    text: "今年も田植えが終わった。父さんはもう田んぼには出ないけど、毎朝この道を歩いて、苗の伸び具合を見に来る。",
  },
  {
    label: "n10",
    photo: "Y1",
    speaker: "ゆい",
    kind: "text",
    daysAgo: 1,
    at: "07:45",
    replyTo: "n9",
    text: "夏休み、じいちゃんと一緒にこの道を歩きたい。",
  },
  {
    label: "n11",
    photo: "P8",
    speaker: "お母さん",
    kind: "text",
    daysAgo: 1,
    at: "12:30",
    text: "二日目の朝、大きな木の前で父が長いこと手を合わせてた。何をお願いしたのか聞いたら、内緒って笑ってた。",
  },
  {
    label: "n12",
    photo: "P8",
    speaker: "じいちゃん",
    kind: "voice",
    daysAgo: 1,
    at: "16:10",
    replyTo: "n11",
    text: "あのときお願いしたのはな、みんなが元気で、また一緒に旅行できますように、って。今だから言うけど。",
  },
];
