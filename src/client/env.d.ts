/** 確かめページ（/check）を入れるか。ビルドのときに vite.config.ts の define で決まる。本番では false。運営の記録の画面（/ops/record）はこの値によらず本番のビルドにも入っている（0030） */
declare const __CHECK_PAGE__: boolean;
