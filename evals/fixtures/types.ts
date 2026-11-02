// evals/fixtures/*.json の形。出し比べのスクリプトから読む。
// 欄の名前と値は src/server/db/schema.ts の members / photos / photo_guesses / narrations に合わせてある。
// ID は読みやすい固定の文字列（本番の crypto.randomUUID() ではない）。

/** 語りの性質。一つの語りに複数付くことがある */
export type NarrationTrait =
  | "dialect" // 方言
  | "short" // 短い
  | "digression" // 話がそれる
  | "ambiguous" // 人や場所があいまいで、推測を誘う
  | "mishearing" // 文字起こしに聞き間違いらしき所がある
  | "reply"; // 家族同士の返事（replyToId あり）

export type FixtureMember = {
  id: string;
  role: "elder" | "family";
  relation: string;
  calledAs: string;
  speechStyle: "standard" | "dialect";
  /** speechStyle が "dialect" のときだけ入る */
  dialectRegion: string | null;
  setUpByMemberId: string | null;
};

export type FixturePhoto = {
  id: string;
  ownerMemberId: string;
  /** 日本時間とみなした YYYY-MM-DDTHH:mm:ss。なければ null */
  takenAt: string | null;
  /** photo_guesses.description に入るような、写っている内容の短い説明（Claude の推測の側） */
  description: string;
  /** このデータの意図。アプリにもプロンプトにも渡さない */
  note: string;
};

/** 聞き間違いのつもりの箇所。heard は transcript の中にちょうど一度だけ出てくる */
export type FixtureMishearing = {
  heard: string;
  intended: string;
  note: string;
};

export type FixtureNarration = {
  id: string;
  speakerMemberId: string;
  photoId: string;
  replyToId: string | null;
  kind: "voice" | "text";
  /** 日本時間の YYYY-MM-DD */
  forDate: string;
  /** 文字起こしそのまま（kind が "text" のときは打った文字） */
  transcript: string;
  traits: NarrationTrait[];
  /** 期待値。プロンプトにもアプリにも渡さない */
  mishearings: FixtureMishearing[];
  /** このデータの意図。アプリにもプロンプトにも渡さない */
  note: string;
};

export type FamilyFixture = {
  id: string;
  summary: string;
  /** 「今日」とみなす日（日本時間） */
  asOfDate: string;
  members: FixtureMember[];
  photos: FixturePhoto[];
  narrations: FixtureNarration[];
};
