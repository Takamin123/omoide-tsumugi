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
  /**
   * 画像のファイル名（リポジトリに入れない。出し比べのときに手元の置き場所から読む）。
   * 置き場所は EVAL_IMAGES_DIR（既定は ~/omoide-demo-seed/prepared）。なければ説明だけを渡す
   */
  imageFile?: string;
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
  /** 日本時間の HH:MM（語った時刻）。なければ 12:00 とみなす */
  at?: string;
  /** 文字起こしそのまま（kind が "text" のときは打った文字） */
  transcript: string;
  /** 声の語りの整えた文字（なければ transcript を整形済みとみなす） */
  cleanedText?: string;
  traits: NarrationTrait[];
  /** 期待値。プロンプトにもアプリにも渡さない */
  mishearings: FixtureMishearing[];
  /** このデータの意図。アプリにもプロンプトにも渡さない */
  note: string;
};

/** その人の入り口に、過去に出した写真（候補の絞り込みの「提示の履歴」） */
export type FixturePastEntrance = {
  memberId: string;
  photoId: string;
  /** 日本時間の YYYY-MM-DD */
  forDate: string;
  /** 日本時間の HH:MM（作った時刻） */
  at: string;
};

/**
 * 家族が語ったことの記録（records の told。0039）。出し比べでは本物の extract_records を呼ばず、手で書く。
 * value は語りの表示の文字（cleanedText、なければ transcript）の連続した部分（言い換えない）
 */
export type FixtureRecord = {
  photoId: string;
  narrationId: string;
  kind: "person" | "place" | "time" | "event";
  value: string;
};

/** むすび（同じ出来事の推測。0044）。出し比べでは本物の musubi_guess を呼ばず、手で書く */
export type FixtureMusubi = {
  id: string;
  photos: { photoId: string; status: "guessed" | "confirmed" | "rejected" }[];
  /** このデータの意図。アプリにもプロンプトにも渡さない */
  note: string;
};

/** 受け取る人がその写真のその場にいたか（期待値。語りと note から分かるものだけ。プロンプトには渡さない） */
export type FixturePresence = {
  photoId: string;
  memberId: string;
  present: "yes" | "no";
  note: string;
};

export type FamilyFixture = {
  /**
   * 変種のとき、元の家族の名前（evals/fixtures/<base>.json）。元の家族を読み、この欄以外の欄で上書きする
   * （id・summary・musubi・continuation などだけを書けばよい）
   */
  base?: string;
  id: string;
  summary: string;
  /** 「今日」とみなす日（日本時間） */
  asOfDate: string;
  members: FixtureMember[];
  photos: FixturePhoto[];
  narrations: FixtureNarration[];
  /** 過去の入り口。なければ全員、初めての入り口 */
  pastEntrances?: FixturePastEntrance[];
  /** told の記録（entrance/v3 の検査に使う。0046） */
  records?: FixtureRecord[];
  /** むすび（entrance/v3 の候補の並びと <same_event> に使う。0046） */
  musubi?: FixtureMusubi[];
  /** その場にいたかの期待値（receiver_present の合致を数える。0046） */
  expectedPresence?: FixturePresence[];
  /** 続きの向きの期待値: この人にこの写真が届くか（0046 の良いと言える条件 2） */
  continuation?: { memberId: string; photoId: string; note: string };
};
