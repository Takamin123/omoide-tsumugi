// 家族に見せる、アプリの固定の言葉。すべてここに置く（docs/implementation-policy.md 1）。
// 短く、素っ気ないくらいに。相づち、励まし、感想、AI を前に出す言葉、試す言葉を入れない。
import type { ErrorKind, TimeSlot } from "../shared/api";

export const words = {
  appName: "おもいでつむぎ",

  /** 問いかけが null（固定の入り口）のときの一文 */
  fixedQuestion: "この写真のころのこと、聞かせてください",

  // 家族の場を作る（/start）
  start: {
    title: "家族の場を作る",
    createToken: "作るための合言葉",
    isDemo: "デモの家族として作る",
    submit: "作る",
    next: "進む",
  },

  // 招待リンクを開いたとき
  join: {
    opening: "開いています",
  },
  noSession: "家族から届いたリンクを開いてください",

  // あなたはどなたですか
  who: {
    title: "あなたはどなたですか",
    other: "この中にいません",
    firstTitle: "まず、あなたのことを入れてください",
  },

  // 家族の一人ひとり
  member: {
    addTitle: "家族を足す",
    selfTitle: "あなたのこと",
    relation: "続柄",
    relationHint: "例: 祖母、母、孫",
    calledAs: "呼ばれ方",
    calledAsHint: "例: ばあば",
    role: "画面",
    roleElder: "声で答える大きな画面（祖父母向け）",
    roleFamily: "スマホの画面",
    speech: "話し方",
    speechStandard: "標準語",
    speechDialect: "方言",
    dialectRegion: "地域",
    dialectRegionHint: "例: 鹿児島",
    submit: "足す",
    summary: (calledAs: string, relation: string) => `${calledAs}（${relation}）`,
    details: (screen: string, speech: string) => `${screen}・${speech}`,
    dialectOf: (region: string) => `方言（${region}）`,
    setUpBy: (name: string) => `${name}が入れました`,
  },

  // 家族のこと（/family）
  family: {
    title: "家族のこと",
    members: "家族",
    invite: "家族に送るリンク",
    inviteHidden: "リンクは作ったときにだけ出ます",
    regenerate: "作り直す",
    regenerateNote: "作り直すと、いまのリンクは使えなくなります",
    regenerateConfirm:
      "いまのリンクは使えなくなります。いまのリンクで開いている端末（タブレットなど）は、新しいリンクで開きなおしが必要です",
    copy: "写す",
    copied: "写しました",
  },

  // 写真
  photos: {
    title: "写真を足す",
    pick: "写真を選ぶ",
    progress: (done: number, total: number) => `${total}枚のうち ${done}枚`,
    added: (n: number) => `登録した写真 ${n}枚`,
    duplicate: (n: number) => `すでにある写真 ${n}枚`,
    unreadable: (n: number) => `読めなかった写真 ${n}枚`,
    failed: (n: number) => `送れなかった写真 ${n}枚`,
  },

  // 祖父母の画面
  elder: {
    speak: "はなす",
    stop: "おわる",
    sent: "おくりました",
    sendFailed: "おくれませんでした。もういちど おしてください",
    resend: "おくる",
    noPhoto: "まだ写真がありません",
    micDenied: "マイクがつかえません",
  },

  // 家族の画面
  home: {
    reply: "返事",
    byText: "文字で",
    byVoice: "声で",
    send: "送る",
    cancel: "やめる",
    menuFamily: "家族のこと",
    menuPhotos: "写真を足す",
    menuHome: "もどる",
    switchUser: "ほかの人にかわる",
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
    not_found: "見つかりませんでした",
    invalid_request: "うまくいきませんでした。もう一度お試しください",
    duplicate: "うまくいきませんでした。もう一度お試しください",
    not_demo: "うまくいきませんでした。もう一度お試しください",
    too_large: "大きすぎて送れませんでした",
    internal: "うまくいきませんでした。もう一度お試しください",
  } satisfies Record<ErrorKind, string>,

  /** 時計と日付の表示 */
  slots: { morning: "朝", noon: "昼", night: "夜" } satisfies Record<TimeSlot, string>,
  clockLabel: (month: number, day: number, slot: string) => `${month}月${day}日 ${slot}`,
  dateLabel: (year: number, month: number, day: number) => `${year}年${month}月${day}日`,

  loading: "読んでいます",
  retry: "もう一度",
} as const;
