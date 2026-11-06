// 審査員の案内の言葉（fable-advisor に相談。0062）。です・ます、短く。「入り口」は使わず「今日の写真と問いかけ」と言う。
// 画面にある名前は、words.ts から差し込む（字を違えない）。​（言葉の切れ目）は外す。
import { words } from "../words";

const q = (label: string) => `「${label.replaceAll("​", "")}」`;

export const guideWords = {
  elderName: "じいちゃん",
  motherName: "お母さん",
  otherNames: ["まさとおじさん", "ゆい"],
  lead: "離れて暮らす家族が、アルバムを囲むように思い出を語り合える場です。Claude は毎朝、一人ひとりに写真と問いかけを一つ届けます。語り合いには割り込みません。架空の三世代の家族でお試しください。",
  stepsTitle: "触る順番",
  step1: {
    title: "じいちゃんで答える",
    body: `写真の下へスクロールすると、問いかけが出ます。これを${q(words.elder.readAloud)}で聞き、${q(words.elder.speak)}か${q(words.elder.write)}で答えます。話し終えたら${q(words.elder.stop)}。`,
  },
  step2: {
    title: "お母さんで聞く",
    body: `下のタブ${q(words.home.tabReplies)}に、じいちゃんの答えが届きます。${q(words.home.listen)}で声を聞けます（届いていなければ${q(words.home.tabAlbum)}に出ています）。`,
  },
  step3: {
    title: "アルバムを見る",
    body: `下のタブ${q(words.home.tabAlbum)}で、写真ごとに積み重なった語りを見られます。`,
  },
  others: "ほかの家族",
  nextTitle: "次の日へ進める",
  nextBody: `各タブの一番下、${q(words.demo.label)}の帯の${q(words.demo.advance)}で朝、昼、夜と進みます。夜から翌朝へ進むと、その日の語りをもとに、Claude が一人ひとりの翌日の写真と問いかけを作ります。これには 2 分ほどかかります。`,
  notesTitle: "ご注意",
  notes: [
    "ボタンを押すと、このブラウザがその人になります。一度に一人です。開いていたほかのタブも、その人として動きます。ほかの人を開くには、ブラウザの「戻る」でこのページへ。",
    "架空の家族です。話した声・書いた文字・入れた写真は、次に見る方にも届きます。",
    `${q(words.family.title)}（人とリンク）は、このデモでは変えられません。`,
    `マイクが使えないときは${q(words.elder.write)}で答えられます。`,
  ],
};
