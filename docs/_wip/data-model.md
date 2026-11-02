# データの形（初日の詳細設計）

初日の土台（家族の場、招待リンク、写真の一括登録、朝・昼・夜を手で進めるデモ）のための表。
ID は `crypto.randomUUID()` の文字列。時刻は UTC のミリ秒（整数）。「その日」は日本時間の `YYYY-MM-DD` の文字列。

## 方針

- **家族が語ったこと** と **Claude の推測** は別の列・別の値で持つ。推測には必ず `model` と `prompt_version` を付ける
- 推測の表・列は、名前で推測と分かるようにする（`guessed_*`、`origin = 'guessed'`）
- どの表にも `family_id` を持たせ、合言葉で確かめた家族の外のものを引けないようにする（ほかの家族のものは 404）

## 表

### families（家族）
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| name | text | 家族の呼び名（例「鈴木家」）。ログに出さない |
| is_demo | integer(bool) | デモの家族。初期化で消してよいのはこれが真の家族だけ |
| clock_date / clock_slot | text / text, null | デモの時計。`clock_slot` は `morning`/`noon`/`night`。null なら本当の時刻で動く。進められるのは、手元とプレビューではどの家族でも、本番ではデモの家族だけ |
| created_at | integer | |

### invite_links（招待リンク）
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id | text FK | |
| token_hash | text unique | 合言葉（32 バイトの乱数を base64url）の SHA-256。平文は持たない |
| created_at / revoked_at | integer / integer null | 作り直すと古いものに `revoked_at` を入れる。有効なのは家族ごとに一つ |

- cookie には合言葉そのものを入れ（HttpOnly, Secure, SameSite=Lax）、毎回ハッシュして有効なリンクを引く。作り直しが即座に効く
- 「自分は誰か」は合言葉では決めない。家族の場に入った後に選び、クライアントに覚えておく（祖父母のタブレットは話者を切り替えるため）

### members（家族の一人ひとり）
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id | text FK | |
| role | text | `elder`（祖父母。タブレットの画面・声で答える）/ `family`（スマホの画面） |
| relation | text | 続柄の言葉（「祖母」「母」「孫」など）。表示と Claude への文脈用 |
| called_as | text | 家族からの呼ばれ方（「ばあば」）。画面ではこれで呼ぶ |
| speech_style | text | `standard` / `dialect` |
| dialect_region | text null | 方言の地域（「鹿児島」）。文字起こしの prompt に使う |
| set_up_by_member_id | text null | 代わりに設定を入れた人（始める人が祖父母の分を入れたとき） |
| created_at | integer | |

### photos（写真）
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id / owner_member_id | text FK | 誰のライブラリの写真か |
| storage_key | text | R2 のキー（`families/<family_id>/photos/<id>.jpg`） |
| content_hash | text | 縮小の前の元ファイルの SHA-256（ブラウザで計算）。`(owner_member_id, content_hash)` を一意にし、同じ写真の二重登録と再送を一つにまとめる |
| width / height | integer | 縮小後 |
| taken_at | text null | 撮影日時（EXIF の値。時差が分からないことが多いので、日本時間とみなした `YYYY-MM-DDTHH:mm:ss`） |
| latitude / longitude | real null | ブラウザで小数第 2 位（約 1 km）に丸めてから送る。生の値は持たない。null なら位置なし |
| created_at | integer | |

### photo_guesses（Claude による写っている内容の説明）
推測なので写真の表と分ける。初日は表だけ作り、中身は作らない。
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| photo_id / family_id | text FK | |
| description | text | 写っている内容の説明（家族には見せない。入り口づくりの材料） |
| model / prompt_version | text | |
| created_at | integer | |

### narrations（語り）
入り口への答えも、家族同士の直接のやり取りも、ここに入れる。
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id | text FK | |
| speaker_member_id | text FK | 誰が |
| photo_id | text FK | どの写真について |
| entrance_id | text null | どの入り口から語られたか |
| reply_to_id | text null | 家族同士のやり取りで、どの語りへの返事か |
| request_id | text null | 再送を見分ける、クライアントが語り一つごとに作る UUID。`(family_id, request_id)` を一意に（0009） |
| kind | text | `voice` / `text` |
| audio_key / audio_content_type | text null | 声の録音（R2） |
| duration_ms | integer null | 録音の長さ |
| transcript | text null | 文字起こしそのまま（`text` のときは打った文字） |
| transcript_status | text | `pending` / `done` / `failed`。失敗しても録音は残し、文字は空のまま |
| cleaned_text | text null | 整えた文字（Claude。言い換えない・足さない） |
| cleaned_model / cleaned_prompt_version | text null | |
| uncertain_spans | text(JSON) null | 怪しい部分 `[{start,end}]`（`cleaned_text` の中の位置。Claude の推測） |
| for_date | text | その語りが属する日（日本時間。デモの家族は時計の日付） |
| created_at | integer | |

- 引用や怪しい部分の位置は `cleaned_text` を基準にし、作った後は作り直さない
- 整形は「削る・区切る」だけ。句読点と改行を除いた `cleaned_text` が `transcript` の部分列でなければ整形を捨てる

### records（記録：人・場所・時期・出来事）
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id | text FK | |
| photo_id | text FK null | どの写真についての記録か（記録と写真の結びつきは、むすびとは別にここで持つ） |
| kind | text | `person` / `place` / `time` / `event` |
| value | text | 「鹿児島の家」「昭和50年ごろ」など |
| origin | text | `told`（家族が語った）/ `guessed`（Claude の推測） |
| told_by_member_id / narration_id | text null | `told` のとき必須（CHECK 制約）。誰がどの語りで |
| quote_start / quote_end | integer null | 語りの中の位置 |
| model / prompt_version | text null | `guessed` のとき必須（CHECK 制約） |
| created_at | integer | |

### musubi（むすび：同じ出来事のまとまり）
家族それぞれのライブラリにある写真と、その写真についての語りを「同じ出来事（同じ日・同じ場面）」としてまとめる。
例: 祖父・父・孫のスマホにあった遊園地の日の写真 3 枚と、三人の語り → 一つの出来事 = 「その日のアルバム」の一ページ。
語りは `narrations.photo_id` を通して、写真と一緒にむすびに入る（語りを別に結ばない）。

| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id | text FK | |
| created_by | text | `guessed`（Claude が推測して作った）/ `family`（家族が自分でまとめた） |
| guessed_reason / model / prompt_version | text null | 推測で作ったとき（家族に見せない） |
| created_at | integer | |

### musubi_photos（むすびに入る写真と、その状態）
状態は写真ごとに持つ（3 枚のうち 1 枚だけ「違う日」と言われることがあるため）。
| 列 | 型 | メモ |
|---|---|---|
| musubi_id / photo_id | text FK | `(musubi_id, photo_id)` が主キー |
| family_id | text FK | |
| status | text | `guessed`（推測）/ `confirmed`（家族が確かめた）/ `rejected`（家族が違うと言った） |
| evidence_narration_id | text null | 根拠の語り。`confirmed`/`rejected` のとき必須（CHECK 制約） |
| decided_at | integer null | |
| created_at | integer | |

### entrances（入り口）
| 列 | 型 | メモ |
|---|---|---|
| id | text PK | |
| family_id / member_id | text FK | 誰に |
| for_date | text | 日本時間の日付。`(member_id, for_date)` を一意に（同じ日に二度呼んでも一つ） |
| photo_id | text FK | どの写真を |
| focus | text(JSON) null | どこから見せるか `{x,y,w,h}`（0〜1 の比率）。null は全体 |
| quote_narration_id / quote_start / quote_end | null | 添える家族の言葉（語りの範囲だけ持ち、本文は語りから引く） |
| question | text null | 問いかけ一つ（Claude の言葉。`kind='claude'` のとき必須）。固定の入り口では null で、固定の一文はクライアントが持つ |
| reason | text null | 選んだ理由（Claude。家族に見せない） |
| kind | text | `claude` / `fixed`（Claude なしの固定の入り口） |
| model / prompt_version / input_narration_ids / input_tokens / output_tokens | null | 組み直すための記録。プロンプトの全文は持たない |
| shown_at | integer null | 初めて見せた時刻。入った後は差し替えない |
| created_at | integer | |

## デモの時計

- 「次の時間帯へ進める」: 朝 → 昼 → 夜 → 翌朝。翌朝になったときに `runMorning(deps, now, { familyId })` を呼ぶ（Cron と同じ関数）
- 昼・夜は時計を進めるだけ（今日は画面の出し分けに使わない）
- 時計を進められるのは、手元とプレビューではどの家族でも、本番ではデモの家族だけ（APP_ENV で判断）。`clock_*` が null の家族は本当の時刻で動く

## 初日の固定の入り口

- 写真: その人の**ほかの家族のライブラリ**から、まだ入り口に使っていないものを撮影日の古い順に一枚（なければ自分の写真も含める）
- 添える言葉: その写真の語りがあれば最新の一つの全文、なければ空
- 問いかけ: null（クライアントの固定の一文「この写真のころのこと、聞かせてください」を出す）

## デモの家族の写真

- 原本は R2 の `demo/seed/`。初期化のたびに `families/<demo_family_id>/...` に写す。初期化は `demo/seed/` を消さない
