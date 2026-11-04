// 家族に見せる、アプリの固定の言葉。すべてここに置く（docs/implementation-policy.md 1）。
// 短く、素っ気ないくらいに。相づち、励まし、感想、AI を前に出す言葉、試す言葉を入れない。
import type { ErrorKind, TimeSlot } from "../shared/api";

/** 録音の長さ（lib/pure.ts の voiceLength が作る） */
type VoiceLength = { minutes: number; seconds: number };
/** 「13秒」「1分20秒」（「12枚のうち 5枚」に合わせ、数と単位の間に空白を入れない） */
const voiceLengthText = ({ minutes, seconds }: VoiceLength) => (minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`);

/** 誰の声か、と長さ「ばあばの声（13秒）」。祖父母の画面と家族の画面で同じ文字列（0028、0045） */
const listenNote = (name: string | null, len: VoiceLength | null) => `${name ? `${name}の` : ""}声${len ? `（${voiceLengthText(len)}）` : ""}`;

/** 「12枚のうち 5枚」 */
const progressText = (at: number, total: number) => `${total}枚のうち ${at}枚`;

// 祖父母の画面。ボタンは一語のひらがな。エラーの文はひらがなで「できること」を言う（家族向けの errors と分ける）
const elderWords = {
  speak: "はなす",
  stop: "おわる",
  sent: "おくりました",
  resend: "おくる",
  cancel: "やめる",
  again: "もういちど",
  /** 答え方の「かく」（文字の欄を開く。0043） */
  write: "かく",
  /** 語りへの返事を開く（0043） */
  reply: "へんじ",
  /** 声を聞くボタン（一語の動詞。0045）。入り口ではそばに、語りでは話者名の行に listenNote を出す */
  listen: "きく",
  /** 誰の声か、と長さ。呼ばれ方が分からなければ「声」だけ、長さが分からなければ秒を出さない */
  listenNote,
  stopVoice: "とめる",
  /** 聞くボタンの読み上げの名前（見えない）。見える「きく」「とめる」を含める。ボタンの側なのでかな（0008。0045 の追記） */
  listenName: (name: string | null) => ({ play: `${name ? `${name}の ` : ""}こえを きく`, stop: `${name ? `${name}の ` : ""}こえを とめる` }),
  /** マイクの許可を待っている間、録るボタンの場所に出す（押せない。0008 の追記）。幅が足りないときは空白か言葉の切れ目（\u200B）でだけ折る */
  micWaiting: "マイクを じゅんび\u200Bしています",
  /** 写真の拡大の画面を閉じる（0040） */
  close: "とじる",
  /** 問いかけの読み上げ（0019） */
  readAloud: "よみあげ",
  readAloudNote: "AI の声で読みます",
  errors: {
    loadFailed: "ひらけませんでした。「もういちど」を おしてください",
    unauthorized: "ひらけませんでした。かぞくに しらせてください",
    sendFailed: "おくれませんでした。「おくる」を おすと、もういちど おくります",
    micDenied: "マイクが つかえません。かぞくに しらせてください",
  },
};

// 家族の画面
const homeWords = {
  reply: "返事",
  sent: "送りました",
  speak: "話す",
  stop: "終わる",
  micDenied: "マイクが使えません",
  /** 声を聞くボタン（一語。長さは入れない。0045）。誰の声か・長さは listenNote */
  listen: "聞く",
  /** 誰の声か、と長さ。祖父母の画面と同じ文字列（0045） */
  listenNote,
  stopVoice: "止める",
  /** 聞くボタンの読み上げの名前（見えない）。見える「聞く」「止める」を含める（0045 の追記） */
  listenName: (name: string | null) => ({ play: `${name ? `${name}の` : ""}声を聞く`, stop: `${name ? `${name}の` : ""}声を止める` }),
  /** マイクの許可を待っている間、録るボタンの場所に出す（押せない。0008 の追記）。幅が足りないときは言葉の切れ目（\u200B）でだけ折る */
  micWaiting: "マイクを\u200B準備しています",
  /** 写真の拡大の画面を閉じる（0040） */
  close: "閉じる",
  /** 「声で話す」「文字で書く」。幅が足りないときは言葉の切れ目（\u200B）でだけ折る（.phrase-break。360px・文字 150% で二行になる） */
  byText: "文字で\u200B書く",
  byVoice: "声で\u200B話す",
  send: "送る",
  cancel: "やめる",
  menuFamily: "家族のこと",
  menuPhotos: "写真を足す",
  menuHome: "もどる",
  /** 読み上げだけの名前（見えない）。上のメニュー、下のタブ、アルバムの写真の帯 */
  menuLabel: "メニュー",
  tabsLabel: "切り替え",
  albumBandLabel: "写真",
  /**
   * アルバムの答えの語りの下の「言葉の糸」。答えた入り口に添えた家族の言葉（引用そのまま）。押すと元の語りへ移る（0035）。
   * 引用が長すぎる（サーバーが text を null で返す）ときは呼ばれ方だけ。「から」の後に動詞を足さない
   */
  thread: (name: string, quote: string | null) => (quote === null ? `${name}の言葉から` : `${name}の『${quote}』から`),
  /** 下のタブ */
  tabToday: "今日",
  tabAlbum: "アルバム",
  /** アルバムの矢印。見た目は矢印だけ。画面の向きで言う（新しい順なので「前」「次」は使わない） */
  albumPrev: "左の写真へ",
  albumNext: "右の写真へ",
  /** アルバムのいま何枚目か。写真を足すの「12枚のうち 5枚」と同じ形 */
  albumPosition: (at: number, total: number) => progressText(at, total),
  /** 同じ文を、折ってよい所（空白）で二つに分けたもの。画面ではこの間でだけ折る */
  albumPositionParts: (at: number, total: number) => progressText(at, total).split(" ") as [string, string],
  /** 語りの欄の見出しの何枚目か。帯の「4枚のうち 2枚」と同じ数え方（1 から、同じ並び）の短い形（0041） */
  albumOrdinal: (at: number) => `${at}枚目`,
};

export const words = {
  appName: "おもいでつむぎ",

  /** 問いかけが null（固定の入り口）のときの一文 */
  fixedQuestion: "この写真のころのこと、聞かせてください",

  // 家族の場を作る（/start）
  start: {
    title: "家族の場を作る",
    createToken: "作るための合言葉",
    createUnauthorized: "作るための合言葉が違います。家族は作っていません",
    isDemo: "デモの家族として作る",
    submit: "作る",
    /** 作った後の見出し。運営がコピーして、始める人に送る（一度きり。0036） */
    firstLink: "最初の人に送るリンク",
    next: "進む",
    // デモを最初の状態に戻す（運営だけ。0038）
    reset: {
      title: "デモを最初の状態に戻す",
      note: "デモの家族の写真・語り・入り口を、台本の状態に戻します。家族の人とリンクはそのままです",
      familyId: "デモの家族の ID",
      token: "戻すための鍵",
      submit: "最初の状態に戻す",
      running: "戻しています。1〜4 分かかります。この画面を閉じないでください",
      elapsed: (sec: number) => `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, "0")}秒たちました`,
      done: "戻しました",
      result: (photos: number, narrations: number, entrances: number) =>
        `写真 ${photos} 枚、語り ${narrations} 本、今日の入り口 ${entrances} 人分`,
      morningFailed: "今日の入り口は作れませんでした。開いたときに用意されます",
      notFound: "その ID のデモの家族は見つかりませんでした。何も変えていません",
      unauthorized: "戻すための鍵が違います。何も変えていません",
    },
  },

  // その人のリンクを開いたとき（0036）
  join: {
    opening: "開いています",
    invalid: "このリンクは使えません。家族に知らせてください",
  },
  noSession: "家族から届いたリンクを開いてください",

  // 最初の人のリンクで開いたとき（0036）。画面の欄は出さない（家族の画面に決まっている）
  firstPerson: {
    title: "まず、あなたのことを入れてください",
  },

  // 家族の一人ひとり
  member: {
    addTitle: "家族を足す",
    relation: "家族の中での立場",
    relationHint: "例: 祖母、母、孫",
    calledAs: "呼ばれ方",
    calledAsHint: "例: ばあば",
    role: "画面",
    roleElder: "文字の大きな画面（祖父母向け）",
    roleFamily: "スマホの画面",
    speech: "話し方",
    speechStandard: "標準語",
    speechDialect: "方言",
    dialectRegion: "地域",
    dialectRegionHint: "例: 鹿児島",
    submit: "足す",
    edit: "直す",
    summary: (calledAs: string, relation: string) => `${calledAs}（${relation}）`,
    details: (screen: string, speech: string) => `${screen}・${speech}`,
    dialectOf: (region: string) => `方言（${region}）`,
    setUpBy: (name: string) => `${name}が入れました`,
  },

  // 家族のこと（/family）
  family: {
    title: "家族のこと",
    members: "家族",
    /** 一人ひとりのカードの補助のボタン（0036）。リンクが使えるなら「作り直す」 */
    makeLink: "リンクを作る",
    remakeLink: "リンクを作り直す",
    /** 作ったリンクの上の一行 */
    linkFor: (name: string) => `${name}に送るリンク`,
    inviteHidden: "リンクは作ったときにだけ出ます",
    /** 作り直すときだけ確かめる */
    regenerateConfirm: "いまのリンクは使えなくなります。いまのリンクで開いている端末は、新しいリンクで開きなおしが必要です",
    copy: "コピー",
    copied: "コピーしました",
    /** 一番下に小さく出す家族 ID の見出し。説明の文は付けない（0033） */
    familyIdLabel: "家族の番号",
    /** 家族の番号をコピーするボタン。招待リンクの「コピー」と見分けるため目的語を付ける（0033） */
    copyFamilyId: "番号をコピー",
    /** 地名の出典（CC BY 4.0 の表示）。家族の番号のさらに下に .sub で一行。祖父母の画面には出さない（0047） */
    placeSource:
      "写真の場所の名前は、デジタル庁「アドレス・ベース・レジストリ」をもとに株式会社 Geolonia が作成した住所データ（CC BY 4.0）から引いています",
  },

  // 写真
  photos: {
    title: "写真を足す",
    pick: "写真を選ぶ",
    progress: (done: number, total: number) => progressText(done, total),
    added: (n: number) => `登録した写真 ${n}枚`,
    duplicate: (n: number) => `すでにある写真 ${n}枚`,
    unreadable: (n: number) => `読めなかった写真 ${n}枚`,
    failed: (n: number) => `送れなかった写真 ${n}枚`,
  },

  elder: elderWords,
  home: homeWords,

  /**
   * 同じ部品（答える・返事・語りの声）の、画面ごとの言葉（0043）。部品は lib/screen.ts の useScreen で引く。
   * 祖父母の画面のボタンは一語のひらがな（0008）。文はひらがなで「できること」を言う（0028）
   */
  screen: {
    family: {
      byVoice: homeWords.byVoice,
      byText: homeWords.byText,
      /** 文字の欄の読み上げの名前 */
      textLabel: homeWords.byText,
      speak: homeWords.speak,
      stop: homeWords.stop,
      send: homeWords.send,
      cancel: homeWords.cancel,
      sent: homeWords.sent,
      micDenied: homeWords.micDenied,
      /** 送れなかったときの文。null なら種類ごとの文（errorText） */
      sendFailed: null,
      reply: homeWords.reply,
      listen: homeWords.listen,
      /** 声の語りの話者名の行に出す「ばあばの声（13秒）」（0045） */
      listenNote: homeWords.listenNote,
      stopVoice: homeWords.stopVoice,
      listenName: homeWords.listenName,
      micWaiting: homeWords.micWaiting,
    },
    elder: {
      /** 選ぶ段の「はなす」は、押すとその場で録り始める（録るボタンを兼ねる） */
      byVoice: elderWords.speak,
      byText: elderWords.write,
      textLabel: elderWords.write,
      speak: elderWords.speak,
      stop: elderWords.stop,
      send: elderWords.resend,
      cancel: elderWords.cancel,
      sent: elderWords.sent,
      micDenied: elderWords.errors.micDenied,
      sendFailed: elderWords.errors.sendFailed,
      reply: elderWords.reply,
      listen: elderWords.listen,
      /** 入り口の添える言葉と同じ注「ばあばの声（13秒）」（0045） */
      listenNote: elderWords.listenNote,
      stopVoice: elderWords.stopVoice,
      listenName: elderWords.listenName,
      micWaiting: elderWords.micWaiting,
    },
  },

  // 写真の拡大の画面（0040）。どちらも読み上げだけの名前（見えない）。祖父母の画面でも同じ
  photoView: {
    /** 押せる写真 */
    open: "写真を大きく見る",
    /** 拡大の画面（dialog）。アルバムの帯の名前と同じ語 */
    label: "写真",
  },

  // デモの操作
  demo: {
    label: "デモ",
    clock: (label: string) => `いま ${label}`,
    advance: "次の時間帯へ",
    sendFile: "録音済みの音声を送る",
  },

  errors: {
    unauthorized: "リンクを開きなおしてください",
    forbidden: "この端末からはできません",
    not_found: "見つかりませんでした",
    invalid_request: "うまくいきませんでした。もう一度お試しください",
    duplicate: "うまくいきませんでした。もう一度お試しください",
    not_demo: "うまくいきませんでした。もう一度お試しください",
    // デモの初期化（運営の画面だけで出る。0038）
    demo_seed_mismatch: "家族の人の呼ばれ方が、デモの台本と合いません。何も変えていません",
    demo_seed_missing: "デモの写真か声が置かれていません。何も変えていません",
    too_large: "大きすぎて送れませんでした",
    internal: "うまくいきませんでした。もう一度お試しください",
  } satisfies Record<ErrorKind, string>,

  /** 時計と日付の表示 */
  slots: { morning: "朝", noon: "昼", night: "夜" } satisfies Record<TimeSlot, string>,
  clockLabel: (month: number, day: number, slot: string) => `${month}月${day}日 ${slot}`,
  dateLabel: (year: number, month: number, day: number) => `${year}年${month}月${day}日`,
  /** 写真の場所。サーバーが一覧から引いた市区町村の名前（「三重県伊勢市」）に「あたり」を付ける。写真の記録で、推測ではない。文にしない（0047） */
  placeLabel: (place: string) => `${place}あたり`,

  loading: "読んでいます",
  retry: "もう一度",
} as const;
