// 自動で作るファイル（evals/demo-seed-clean.eval.ts）。手で書き換えない。
// デモの種の声の語りを、本物の Haiku（clean_transcript）で一度整えた結果。初期化はこれを写す（0038）
// 作った日: 2026-11-03
import type { NarrationCleaned } from "../core/ports";

export const SEED_CLEANED: Record<string, NarrationCleaned> = {
  "n1": {
    "cleanedText": "夫婦岩は、テレビでしか見たことなかったんだ。本物は思ったより小さくてな、でも縄がぴんと張ってて、きれいだった。ばあちゃんと並んで、うちらみたいだなって言ったら、みんなに笑われたんだよ。",
    "uncertainSpans": [],
    "cleanedModel": "claude-haiku-5-5",
    "cleanedPromptVersion": "clean_transcript/v2"
  },
  "n7": {
    "cleanedText": "ばあちゃんはいつもそうなんだ。孫が食べてるとこ見てるのが、一番のごちそうなんだって。山形の芋煮もうまいけど、あの肉は口の中でとけたなぁ。",
    "uncertainSpans": [],
    "cleanedModel": "claude-haiku-5-5",
    "cleanedPromptVersion": "clean_transcript/v2"
  },
  "n8": {
    "cleanedText": "最上川のこのあたりは、若いころよく舟で渡ったんだ。川の真ん中に大きな岩があってな、伊勢で夫婦岩を見たとき、あの岩を思い出したんだよ。",
    "uncertainSpans": [],
    "cleanedModel": "claude-haiku-5-5",
    "cleanedPromptVersion": "clean_transcript/v2"
  }
};
