// Claude の応答を受け取った後の、機械的な検査の部品。方針をプロンプトに書くだけに頼らない（implementation-policy 2）。
// 入り口の検査の本体（引用の ID が実在するか、など）は、用途ごとに呼ぶ側が組み立てる。

/** 問いかけの文字数の上限 */
export const QUESTION_MAX_CHARS = 60;

/** 試す言い回しの種類。ログには種類だけを出す（本文は出さない） */
export type TestingPhraseKind = "remember" | "recall" | "quiz" | "identify";

// 正解のある問い（記憶を試す、当てさせる）を見つける。開かれた問いかけ（「どんな日でしたか」）は通す。
// 迷う言い回しは止める側に倒す: 問いかけが一つ止まっても、固定の入り口に倒れるだけで済む。
const TESTING_PATTERNS: ReadonlyArray<readonly [TestingPhraseKind, RegExp]> = [
  // 覚えていますか／覚えてる？／憶えて／おぼえとる／見覚え
  ["remember", /(覚|憶|おぼ)え/],
  // 思い出せますか／思い出しますか／思い出されますか／おもいだせる（名詞の「思い出」は通す）
  ["recall", /(思い|想い|おもい)(出|だ)(せ|し|す|さ)/],
  ["recall", /記憶/],
  // 誰か分かりますか／わかる？／わかるかな
  ["quiz", /(分か|わか|判)(り|る)(ます)?(か|\?)/],
  // ご存じですか／知っていますか／知ってる？／知っとる？／知ってた？
  ["quiz", /ご存[じ知]/],
  ["quiz", /知っ(て|と)(っ|い|た|る|ます|ました)*(か|\?)/],
  // 当ててください／当ててみて／当てられますか
  ["quiz", /(当|あ)て(て(ください|み|ね)|られ)/],
  // 写っているものの正体を答えさせる形（疑問詞が述語になる）。「この人は誰ですか」「これはどこ？」「いつごろの写真でしょうか」
  // 「何歳のころですか」「誰だと思いますか」「お名前は？」。疑問詞が節の中にある「誰と一緒でしたか」「どこへ行った帰りでしたか」は通す（0020）
  ["identify", /(誰|だれ|どなた|どこ|いつ|何歳|なんさい)(ごろ|ころ|頃)?(の(写真|こと|ころ|頃|とき|時))?((です|でした|でしょう|だろう)(か|\?)?|\?)/],
  ["identify", /(誰|だれ|どなた|どこ)の[^?。、]{1,6}?(です|でした|でしょう|だろう)/],
  ["identify", /(誰|だれ|どなた|どこ|いつ|何歳|なんさい)だと思/],
  ["identify", /名前(は|を)(\?|$|何|なん)/],
  // 何でしょう／誰でしょう（疑問詞がそのまま述語になる形だけ。「何をしたのでしょう」は通す）
  ["quiz", /(誰|だれ|どなた|何|なに|なん)(だ|で)しょう/],
];

function normalize(text: string): string {
  // 全角の「？」を「?」に、半角カナを全角に（NFKC）。カタカナをひらがなに。空白（全角を含む）を除く
  return text
    .normalize("NFKC")
    .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

/** 試す言い回しがあれば、その種類を返す。なければ null */
export function findTestingPhrase(text: string): TestingPhraseKind | null {
  const t = normalize(text);
  for (const [kind, re] of TESTING_PATTERNS) {
    if (re.test(t)) return kind;
  }
  return null;
}

const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

/** 見た目の文字数（書記素の数）。絵文字や結合文字を一字と数える */
export function charCount(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

export function exceedsChars(text: string, max: number): boolean {
  return charCount(text) > max;
}

/** 問いの印（「？」「?」）の数。問いかけは一つ、を確かめるのに使う */
export function questionCount(text: string): number {
  return (normalize(text).match(/\?/g) ?? []).length;
}
