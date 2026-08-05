@AGENTS.md

# 楽天ランキング トレンドダッシュボード

楽天ランキングを定期収集・蓄積し、前回スナップショットとの差分をGeminiで分析、
Next.jsダッシュボードで可視化するアプリ。詳細な対応状況は [TODO.md](./TODO.md) を参照。

## 技術スタック

- Next.js (App Router, TypeScript, Tailwind CSS)、Vercel (Hobbyプラン) にデプロイ
- AWS DynamoDB (AWS SDK v3: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`)
- 楽天ウェブサービス Ranking API (2026年移行後の新エンドポイント `openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601`。詳細は下記「楽天API利用時の注意」を参照)
- Google Gemini API (`@google/genai`, モデル `gemini-3-flash-preview`)
- Recharts (グラフ描画)
- Open-Meteo (気象データ、APIキー不要)

## ディレクトリ構成と役割

```
scripts/create-table.mjs        DynamoDBテーブル+GSI作成 (npm run db:create-table)
src/lib/config/env.ts           環境変数アクセサ (未設定なら例外を投げる)
src/lib/aws/dynamodb.ts         DynamoDBDocumentClient
src/lib/date/jst.ts             JST暦日ユーティリティ (toJstDateString/addDaysJst/formatJstDateLabel)
src/lib/db/
  keys.ts                       PK/SK/GSIキー生成ロジック (単一テーブル設計)
  types.ts                      DynamoDBアイテムの型定義
  rankingRepository.ts          データアクセス層 (CRUD)
src/lib/rakuten/
  genres.ts                     収集対象「主要中ジャンル」マスタ
  client.ts                     楽天ランキングAPIクライアント
  types.ts                      APIレスポンス/正規化データの型
src/lib/weather/
  openMeteo.ts                  Open-Meteoから東京の日次気象(実測値)を取得
  weatherCode.ts                WMO weather code → 日本語ラベル変換
src/lib/analysis/
  diff.ts                       前回スナップショットとの差分検知
  gemini.ts                     Geminiによるトレンド考察生成 (気象/トレンド因果分析込み)
  trendSummary.ts                Gemini Google Search groundingによる世間のトレンド要約
src/lib/collectAndAnalyze.ts    「取得→気象/トレンド取得→差分検知→AI分析→保存」のオーケストレーション
src/app/api/
  cron/collect/route.ts         定期収集バッチのエントリポイント
  genres/route.ts, rankings/route.ts, insights/route.ts  ダッシュボード用API (&date=でバックナンバー対応)
  dates/route.ts                 収集済み日付一覧 (バックナンバー選択用)
  daily-context/route.ts         指定日の気象・トレンド(判断材料)取得
src/components/                 GenreSelector, HistoryDatePicker, RankingLeaderboard, RankingChart, InsightCard, Dashboard
```

## DynamoDB 設計 (単一テーブル `RakutenRankings`)

3種類のエンティティをPK/SKパターンで1テーブルに同居させている。

| エンティティ | PK | SK | 用途 |
|---|---|---|---|
| ランキングitem | `GENRE#{genreId}#ITEM#{itemCode}` | `TS#{timestamp}` | 商品ごとの順位・価格の時系列 (`getItemTimeSeries`) |
| GSI1 (上記の別引き) | `GENRE#{genreId}` | `TS#{timestamp}#RANK#{rank}` | ジャンル×時刻の順位表を取得 (`getSnapshotAtTimestamp`) |
| ジャンルメタ | `GENRE#{genreId}#META` | `LATEST` | 直近2回分の収集timestampを保持し、差分検知の基準にする |
| AIインサイト | `GENRE#{genreId}#INSIGHT` | `TS#{timestamp}` | Gemini生成コメント+差分ハイライトの履歴 |
| 気象(日次) | `WEATHER#{date}` | `DAILY` | 東京の実測気象データ。`date`はその気象が実際に発生したJST暦日 |
| トレンド(日次) | `TREND#{date}` | `DAILY` | Gemini検索groundingによる世間のトレンド要約。`date`は要約対象のJST暦日 |
| 日次バンドル索引 | `DAY#{date}` | `META` | ランキング収集日(`date`)から`timestamp`/`causalDate`を引く。GSI2でdate降順一覧も可能 |

**差分検知の前提**: `collectAndAnalyzeGenre` は「ジャンルメタのlatestTimestamp」を前回スナップショットの
timestampとして扱い、そのタイムスタンプでGSI1を引いて前回の順位表を再構成する。1つの収集バッチ内で
1ジャンルの全商品が同一のtimestamp文字列を共有する前提でチャート側のマージ処理(`RankingChart.tsx`の
`mergeSeries`)も書かれているため、収集バッチのtimestampは**ジャンル単位・バッチ単位で使い回すこと**
(商品ごと・APIコールごとに新しい`Date.now()`を取らない)。ここを崩すと折れ線グラフが点だけになる
(検証時に実際にこの不具合をモックで再現して確認済み)。

## 気象・世間のトレンドの統合 (因果関係分析の設計)

ユーザーから「気象データ」と「世間のトレンド」をAI分析に統合し、因果関係の深掘りと将来予測の
精度を高めたいという要望を受けて追加した機能。設計の要点は以下の通り。

- **タイムラグの扱い**: 「7時収集のランキングは前日の消費行動が反映された結果」という前提に
  基づき、`causalDate = 収集日(JST) - 1日`(`src/lib/date/jst.ts`の`addDaysJst`)を気象・
  トレンドの対象日として扱う。気象・トレンド自体は「発生した日」をキーに独立した時系列として
  蓄積し(`WEATHER#{date}`/`TREND#{date}`)、「どのランキング日にどの気象日を紐付けるか」は
  保存時ではなく参照時(`causalDate`の計算)で決めている。ラグを「前日」から「直近3日平均」等に
  変更したくなっても、過去データの再キー付けは不要。
- **追加の夜間バッチは不要**: Open-Meteoの`past_days`パラメータは確定済みの実測値を返すため、
  7時のCron実行時点で前日(`causalDate`)は既に終わっており、予報ではなく確定情報として
  同じCron内で即座に取得できる。そのためHobbyプランの「Cronは1日1回まで」という制約の中に
  収まっている(`collectAndAnalyzeAllGenres`が唯一のエントリポイント)。
- **1日1回・全ジャンル共通で取得**: 気象・トレンドの取得はジャンルループの外で1回だけ行い
  (`getOrFetchWeatherContext`/`getOrFetchTrendContext`)、既にDBにその日のキャッシュが
  あれば再利用する。ジャンルごとに16回呼ぶと東京の天気やGeminiのトレンド要約を無駄に繰り返す
  ことになるため。
- **トレンド要約はGemini自身のGoogle Search groundingで生成**: `src/lib/analysis/trendSummary.ts`。
  新規の外部ニュースAPI契約は行っていない。**構造化出力(`responseSchema`)と`googleSearch`
  ツールは同時利用できないため、この呼び出しは意図的にプレーンテキストで受け取り、ランキング
  分析用の構造化JSON呼び出し(`gemini.ts`)とは別のGemini呼び出しとして分離してある。**
  この分離を崩して1回のGemini呼び出しに統合しようとすると、構造化出力が壊れるので注意。
- **Geminiプロンプトへの反映**: `trendAnalysis`/`forecast`という既存の出力フィールド構成は
  変更せず、気象・トレンド情報をプロンプトに追加した上で「データから合理的に説明できる関連が
  あれば因果関係(気温上昇→冷感グッズ需要、等)に触れる。薄ければ無理にこじつけない」旨を
  指示している。存在しない因果関係を作り上げないという、対応16.以来のガードレール方針を踏襲。
- **バックナンバー機能**: 過去の収集日を選んで、当時のランキング・気象・トレンド・AI分析を
  一式で切り替えて閲覧できる(`HistoryDatePicker` + `/api/dates` + `/api/daily-context` +
  `/api/rankings`・`/api/insights`の`&date=`パラメータ)。`DAY#{date}`索引から`timestamp`を
  引き、既存の`getSnapshotAtTimestamp`/新設`getInsightAtTimestamp`をそのまま使うだけで
  実現しており、ランキング側のキー構造(GSI1)は変更していない。
- **GSI2とIAM権限(要対応)**: 日付一覧を新しい順に取得するため`GSI2_DailyBundle`
  (`GSI2PK`固定値`"DAILY_BUNDLE"` / `GSI2SK=date`) を新設した。**本番DynamoDBへの追加には
  `dynamodb:UpdateTable`権限が必要だが、現在IAMユーザー`rakuten_ranking_api`にアタッチ
  済みの最小権限ポリシーはこれを許可しておらず、`npm run db:create-table`実行時に
  `AccessDeniedException`になることを確認済み。** `iam/dynamodb-policy.json`は
  `UpdateTable`権限+`GSI2_DailyBundle`のARNを追加する形で更新済みだが、実際にAWSへの
  適用(ポリシー作成・アタッチ)はユーザー側の対応が必要(TODO.md未対応リスト参照)。
  未適用の間は`/api/dates`・`/api/daily-context`が500を返すが、フロントエンドは
  日付ピッカー・判断材料パネルを単に非表示にするだけでクラッシュはしない
  (Playwrightで確認済み)。

## 楽天API利用時の注意

- `TARGET_GENRES` (`src/lib/rakuten/genres.ts`) は食品・ドリンク関連の中ジャンル(レベル2)16件。
  実際にAPIから全件データ取得できることは確認済みだが、正式な `IchibaGenre/Search` によるジャンル名の
  突合はまだ行っていない。
- レート制限を考慮し、複数ジャンル取得時はジャンル間で約1.1秒待機している
  (`fetchAllTargetGenreRankings` / `collectAndAnalyzeAllGenres`)。ジャンル数を増やす場合は
  バッチ全体の実行時間がジャンル数に比例して伸びる点に注意。

### 2026年の楽天APIインフラ移行 (重要・ハマりどころ)

楽天は2026年5月13日を期限に、Ichiba系APIを旧ドメイン `app.rakuten.co.jp/services/api/...` +
`applicationId` 単体認証から、新ドメイン `openapi.rakuten.co.jp/ichibaranking/api/...` + 新しい
認証方式へ全面移行した(旧ドメインは実質廃止で、叩くと`503 under maintenance`という紛らわしい
エラーになる — 一時的なメンテナンスだと誤認しやすいので注意)。`src/lib/rakuten/client.ts` は
新方式に対応済みだが、今後このファイルを触る際は以下を崩さないこと。

- **`applicationId` に加えて `accessKey` も必須。** 両方とも新方式で再登録しないと発行されない
  (旧アプリIDのままでは動かない)。`env.rakuten.accessKey` (`RAKUTEN_ACCESS_KEY`環境変数) を参照。
- **`Referer` / `Origin` ヘッダーが必須。** 付けないと `403 REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING`
  になる。値は楽天アプリ登録時に「許可されたWebサイト」として申請したドメイン
  (`SITE_ORIGIN` 定数 = `https://rakuten-ranking-dashboard.vercel.app`) と一致させること。
  サーバーサイドの`fetch()`は素の状態だとRefererを送らないため、これを忘れると必ず失敗する。
- **`period=realtime` が必須。** genreId単体指定(age/sexなし)の場合、`daily`等を指定すると
  `400 wrong_parameter (set period from realtime)` になる。`fetchGenreRanking`のデフォルト値も
  `realtime`にしてある。
- 楽天アプリの登録時、「アプリケーションタイプ」で「API/バックエンドサービス」を選ぶと
  「許可されたIPアドレス」を要求されるが、Vercel Hobbyはサーバーレス関数の送信元IPを固定できない
  (Static IPsはPro/Enterprise限定・$100/月)。そのため登録時は**「Webアプリケーション」**タイプを選び、
  ドメインベースの「許可されたWebサイト」で登録している。
- **`itemPrice` が数値ではなく文字列で返ってくることがある。** 新エンドポイント移行後、実データで
  `Item.itemPrice` が `"3290"` のような文字列になっているのを本番DynamoDBで確認済み(型定義上は
  `number`だが実態と食い違っていた)。`client.ts`で`Number(Item.itemPrice)`により明示的に変換して
  いるので、この変換を消さないこと。なお、この修正より前(2026-07-29の収集分まで)にDBへ書き込まれた
  `RankingSnapshotItem.price`等は文字列のまま残っており、バックフィルはまだ行っていない。

## 差分検知の閾値と、ランキング表示用/Gemini用ハイライトの分離

`src/lib/analysis/diff.ts` の `DIFF_THRESHOLDS` で閾値を調整する。運用しながらチューニングする想定。

**`detectDiffHighlights` は閾値を超えた変化を件数の上限なく全て返す。** これはランキング表
(`RankingLeaderboard.tsx`の「変動」列)がこの戻り値をそのまま`itemCode`単位で表示するため、
ここで絞り込むと表の一部の商品だけ変動情報が欠けてしまうことになる。DynamoDBへの保存
(`InsightItem.highlights`)もこの全件版。

一方、Geminiに渡すハイライトは`selectHighlightsForGemini`で別途最大8件(`MAX_HIGHLIGHTS`)に
絞っている(呼び出し側は`collectAndAnalyzeGenre`)。理由: 全件をそのままプロンプトに含めると
ジャンルによっては(特に総入れ替わりの激しいジャンルで)数十件になり、プロンプトが肥大化して
Gemini呼び出しコスト・分析文の質に影響するため。**ランキング表に出したい変動と、Geminiの
分析材料にしたい変動は別物と考え、件数を増やしたい/絞りたい場合はどちらの関数を触るべきか
区別すること**(表示側を増やしたいなら`detectDiffHighlights`側は触らずそのままでよい。
Gemini側だけ絞り込みたいなら`selectHighlightsForGemini`を調整する)。

楽天のリアルタイムランキング(`period=realtime`)は母数の小さいジャンルほど日次の総入れ替わりが
激しく、実データでは前回スナップショットとの商品重複が0/30〜20/30件程度まで落ち込むことがある。
新規ランクインの重要度を無条件に最優先すると、こうした高回転ジャンルで`selectHighlightsForGemini`
の8枠が全部NEW_ENTRYに占有され、ランク上昇/下降・価格変動のハイライトがGeminiに渡らなくなる
(実際に本番データでこの現象を確認済み)。そのため`MAX_NEW_ENTRY_HIGHLIGHTS`(現在4件)で
新規ランクインの採用数に上限を設け、残り枠を他タイプに確保している。この上限を撤廃/緩和する
変更を行う際は、新規ランクインだけでGemini側のハイライトが埋まっていないか実データで確認すること
(ランキング表側は上限なしのため、この問題の影響を受けない)。

## Gemini呼び出しのタイムアウト設定 (300秒予算を1回の高負荷で使い切らせない)

**2026-08-05にCronが実質0ジャンル処理のままタイムアウトする障害が発生した。** 原因はGeminiが
`503 (高負荷)`を返した際、`@google/genai`のSDKが既定で最大5回・指数バックオフ付きで自動リトライ
することで、`fetchDailyTrendSummary`(トレンド要約、ジャンルループの外で1回だけ呼ばれる)の
1回の呼び出しだけでVercel Hobbyの300秒予算をほぼ使い切ってしまい、そのあとの16ジャンル分の
ループにほとんど時間が残らず`Vercel Runtime Timeout Error`で強制終了していた。呼び出し自体は
`try/catch`で失敗を握りつぶしnullを返す設計だったが、**リトライに要する時間そのものは
try/catchでは短縮できない**ため、この設計だけでは不十分だった。手動での複数回リトライで
最終的に全16ジャンルの収集は完了させたが(詳細はこのセッションのやり取り参照)、再発防止として
`generateTrendInsight`(`gemini.ts`)・`fetchDailyTrendSummary`(`trendSummary.ts`)の両方の
`generateContent`呼び出しに`config.httpOptions`で明示的な`timeout`と`retryOptions.attempts: 1`
(リトライ無し)を設定した。

- 300秒予算のうち、16ジャンル分の楽天API呼び出し+ジャンル間待機(概算70秒)を差し引いた
  残り約230秒を、トレンド要約1回+ジャンルごとの`generateTrendInsight`最大16回(計17回)で
  分け合う計算で、`generateTrendInsight`側は`timeout: 12_000`(12秒)、`fetchDailyTrendSummary`
  側は1日1回しか呼ばれない分の余裕を見て`timeout: 20_000`(20秒)にしている
  (`GEMINI_HTTP_OPTIONS`/`TREND_HTTP_OPTIONS`定数)。
- リトライを`attempts: 1`(リトライ無し)にしているのは意図的。SDK既定のリトライ+バックオフを
  残したまま短いタイムアウトだけ設定すると、リトライのたびにタイムアウト×試行回数分の時間を
  消費し、結局同じ問題が形を変えて再発するため。失敗時の救済は「呼び出し側の`try/catch`で
  該当ジャンルだけスキップし他ジャンルの処理を続ける」という既存の設計(と、必要なら翌日の
  自動収集または手動での`/api/cron/collect`再実行)に委ねている。
- タイムアウト値やジャンル数を変更する際は、上記の予算計算(300秒 - 楽天API分 ≒ トレンド1回 +
  ジャンル数分のGemini呼び出し)を再計算し、**「17回全てが最悪ケース(タイムアウトいっぱいまで
  待つ)になっても300秒を超えない」ことを確認すること**。個々の呼び出しが速く成功する前提の
  見積もりをしないこと(今回の障害はまさにその前提が崩れて起きた)。

## Geminiプロンプトの日付グラウンディング

`src/lib/analysis/gemini.ts`のプロンプトには収集タイムスタンプから算出した本日の日付(JST)を
明示的に含めている。理由: 楽天の商品名には実際の時期と無関係に「お中元」等の販促・SEOキーワードが
大量に埋め込まれており、日付を与えずに季節性を推論させると、Geminiがこれらのキーワードに引っ張られ
時期的に矛盾した(例: 時期外れの「お中元シーズン到来」)分析文を生成することを実データで確認した
(2026-07-29〜30の収集で16ジャンル中13ジャンルが判で押したように「お中元」を主因として挙げていた)。
プロンプトを変更する際も、日付の明示と「データから読み取れる範囲を超えた物語を作らない」旨の
注意書きは維持すること。

## Geminiプロンプトの前回分析との連続性

`collectAndAnalyzeGenre`(`src/lib/collectAndAnalyze.ts`)は、Gemini呼び出し前に
`getLatestInsight()`で前回のインサイト(`aiAnalysisText`/`forecastText`)を取得し、
`generateTrendInsight`の`previousInsight`引数に渡している。`gemini.ts`のプロンプトは
これを「前回分析(参考・連続性のため)」として提示し、前回の文章をそのまま繰り返さず
「今回の変動が前回の続きか・方向転換か・変化なしか」を意識するよう指示している。
**これは前回比との連続性を持たせる軽量な対応であり、週次/月次のロールアップ集計のような
本格的な長期・季節トレンド分析ではない。** ユーザーからは「前回比較にしかなっておらず
長期分析が難しいのでは」という指摘を受けており、対応する場合は`getItemTimeSeries`
(既存の商品別時系列取得)を使って複数収集分を集計するロジックを別途追加する必要がある。

## AIインサイトの表示 (常に表示中の日1件のみ)

`InsightCard.tsx`は当初、`/api/insights`の直近5件をネイティブの`<details>`/`<summary>`による
アコーディオン(最新1件のみ展開・過去分は折りたたみ)で表示していた。実データで5件を単純に
縦積み表示するとページが約3900pxまで伸びる問題への対処だったが、対応22./24.で表示日ピッカー
(`HistoryDatePicker`)を導入し、任意の過去日に遡って閲覧できるようになったことで、
インサイト欄に複数日分を積んで見せる必要自体が無くなった。ユーザーからの「表示日当日以外の
分析は表示させなくていい」という指摘を受け、`InsightCard`はアコーディオンをやめて
**常に表示中の1日分だけを常時展開の単一カードで表示する**方式に単純化した。
`Dashboard.tsx`側は、最新表示時は`/api/insights?genreId=...`(dateなし)、過去日表示時は
`&date=`で、どちらも常に最大1件だけ取得する(`/api/insights`は元々`limit`パラメータを
持っていたが、対応26.で「常に最大1件」の設計に合わせて廃止し、`GenreMeta.latestTimestamp`/
`DAY#{date}`バンドルからtimestampを1つ解決する方式に書き換えた)。`isLatest`のような
分岐props・「最新」バッジも不要になったため削除している。ここを拡張する際、複数日分を
1画面に積み重ねる縦積み/アコーディオン表示には戻さないこと(表示日の切り替えは
日付ピッカー側の役割)。

**変動ハイライトバッジは`InsightCard`ではなく`RankingLeaderboard`側に表示する。**
新規ランクイン・順位急変・値上げ/値下げのバッジ(`HIGHLIGHT_META`/`movementLabel`、
`src/lib/format/highlight.ts`に集約)は元々`InsightCard`内にあったが、ユーザーから
「分析欄の変動情報をランキング表側にまとめたい」という要望を受け、ランキング表(`RankingLeaderboard.tsx`)
の各行に「変動」列として表示する方式に変更した。`Dashboard.tsx`は最新1件のインサイト
(`insights[0]`)の`highlights`のみを`itemCode`引きのMapに変換して`RankingLeaderboard`に渡す
(過去のインサイトのハイライトは現在の順位表と対応しないため使わない)。`InsightCard`は
分析文・予測文のみを表示する。

## 差分ハイライトの保存はGemini分析の成否から独立させている (対応26.)

ユーザーから「1年分など長期でデータが溜まった際に季節性・長期トレンドを分析できるか」と
問われたのをきっかけに、データ完全性の穴を1つ発見・修正した。

- **問題**: 以前は差分ハイライト(`DiffHighlightRecord[]`)を`InsightItem`に同梱して
  `putInsight`で保存しており、`putInsight`はGemini呼び出しが**成功した場合のみ**
  (`collectAndAnalyzeGenre`のtry блок内)呼ばれていた。そのため、差分検知自体はできていても
  Gemini API障害(2026-08-05に実際に発生した300秒タイムアウト障害を参照)でその日の
  Gemini呼び出しが失敗すると、ハイライトの生データごと丸ごと失われ、当日のランキング表の
  「変動」列も空になっていた。将来の長期分析はこの生データ(ジャンル単位の値上げ/値下げ・
  新規ランクイン件数の月次集計など)を主な材料にする想定のため、この欠落は放置できないと判断した。
- **対応**: 差分ハイライトを`InsightItem`から切り離し、`DiffHighlightsItem`
  (`GENRE#{genreId}#HIGHLIGHTS` / `TS#{timestamp}`)という独立エンティティに変更。
  `collectAndAnalyzeGenre`(`collectAndAnalyze.ts`)は、差分検知ができた時点で
  Gemini呼び出しの前に`putHighlights`を必ず呼ぶ。`putInsight`はAI分析テキスト
  (`aiAnalysisText`/`forecastText`)のみを保存する形に縮小した。
- **後方互換**: この変更より前に書き込まれた過去の`InsightItem`には`highlights`が
  埋め込まれたまま残っている。`InsightItem.highlights`は型定義上`@deprecated`かつoptionalの
  まま残し、`/api/insights`は`DiffHighlightsItem`が無い場合(＝この対応より前の日付)のみ
  `InsightItem.highlights`にフォールバックする。バックフィルは行っていない
  (対応23.のバックフィル同様、生データから復元可能なものは無理にバックフィルしない方針)。
- **`/api/insights`の書き換え**: 「その日の収集バッチが使ったtimestamp」を先に解決してから
  (dateありなら`DAY#{date}`バンドル、最新表示なら`GenreMeta.latestTimestamp` — どちらも
  Gemini呼び出しの成否とは無関係に必ず更新される)、AI分析(`InsightItem`)とハイライト
  (`DiffHighlightsItem`)を**独立に**引いてマージするよう変更した。以前は最新表示時に
  `listInsights`(`InsightItem`の一覧クエリ)を使っており、これだと当日Geminiが失敗した場合
  「最新」が前日のInsightItemにフォールバックしてしまい、当日のランキングと噛み合わない
  古いハイライトを表示しかねなかった(この問題があったため`listInsights`は削除した)。
- **フロントエンドの3状態対応**: `InsightCard.tsx`の`InsightData.aiAnalysisText`を
  `string | null`に変更し、(1)変動なし(`insight`自体がnull)、(2)変動を検知したが
  AI分析文がない(Gemini失敗)、(3)AI分析文あり、の3状態を描画するようにした。(2)の場合は
  「本日は変動を検知しましたが、AI分析コメントは取得できませんでした。ランキング表の
  「変動」列で内容をご確認いただけます。」と表示し、本文・予測・判断材料ブロックは
  出さない。ここを触る際、`aiAnalysisText`がnullになりうる前提を崩さないこと。
- **未着手**: 週次/月次ロールアップの集計処理・専用のGemini長期分析呼び出し自体はまだ
  実装していない(対応19.以来の既知の未実装事項、TODO.md参照)。今回はその前提となる
  生データの完全性を担保しただけ。

## フロントエンド実装で踏んだ制約 (このNext.js/Reactバージョン固有)

このプロジェクトの`eslint-plugin-react-hooks`は通常より厳しいルールが有効になっている。

- **`react-hooks/set-state-in-effect`**: `useEffect`本体の同期的な(awaitより前の)setState呼び出しを
  エラーにする。ローディングフラグは「fetch完了後にsetStateする」か、「取得済みキーとの比較による
  派生値」として表現し、effect起動直後にsetStateしない設計にすること(`Dashboard.tsx`の
  `isLeaderboardLoading`は`loadedGenreId`との比較による派生値)。
- **`react-hooks/refs`**: レンダー中の`ref.current`の読み書きも禁止。前回値を引き継ぐ派生状態は、
  effectやrefで後追い計算せず、**選択操作を行うイベントハンドラの中でその場にstateを更新する**
  方式にすること(`Dashboard.tsx`の`handleSelectItem`を参照。既取得済み時系列データの再フェッチ
  防止に使う`fetchedSeriesKeys`のような「実際に副作用が必要なref」はeffect内で読み書きする分には
  問題ない)。

`AGENTS.md`にある通りNext.js自体もAPIが学習データと異なる場合があるため、新しい規約を使う前に
`node_modules/next/dist/docs/`を確認する。

### グラフは単一商品の順位/価格を1枚に重ねる (Rechartsの`<Legend>`は使わない)

グラフはもともと最大5商品を比較する複数系列表示だったが、ユーザーからの要望で**単一商品のみを
選択する方式**に変更した(`RankingLeaderboard`の選択列がcheckbox→radioに変更され、
`Dashboard.tsx`の状態も`selectedItemCodes: string[]`→`selectedItemCode: string | null`に
なっている)。1商品を選ぶと、その商品の「順位の推移」と「価格の推移」を**1枚のグラフに2本の
ラインとして重ねて**表示する(`RankingChart.tsx`)。RechartsのdualYAxis(`yAxisId="rank"`/
`"price"`)を使い、順位軸は`reversed`(1位が上)、価格軸は右側に独立スケールで表示する。
系列を色分けする凡例(`MetricLegend`)は「順位」「価格」の2種類固定のシンプルな凡例で、
商品名は表示しない(対象商品は常に1件なので、色は商品ではなく指標を表す)。

楽天の商品名は60〜100文字を超えることが珍しくない。Recharts標準の`<Legend>`にそのまま渡すと、
名前が折り返し放題になりコンテナからはみ出して下のランキング表と重なる崩れ方をする(実際にモック無しの
本番データで再現・確認済み)。この問題自体は単一商品化後も構造的には起こりうるため、
`RankingChart.tsx`では引き続きRecharts標準`<Legend>`は使わず、選択中商品名はグラフ上部の見出しに
`truncate`+`title`属性のホバー表示で出す形にしている。ここを直す/拡張する際もRecharts標準Legendには
戻さないこと。

### 商品名冒頭の販促文言の除去 (表示専用)

楽天の商品名は「今夜23:59までポイント10倍！お試し送料無料2,490円～」のような販促・SEO文言が
冒頭に付くことが非常に多く、truncate表示だと肝心の商品名が見えないことが実データで多数確認された。
`src/lib/format/itemName.ts`の`displayItemName()`がこれを表示専用に取り除く
(`RankingLeaderboard`の商品名列 / `RankingChart`のグラフ見出しで使用)。
正規表現ベースの経験則で、元の`itemName`データは一切変更しない。呼び出し側は必ず`title`属性等で
元の全文を確認できるようにすること。この関数を拡張する際は、実データ(`/api/rankings`)の商品名で
`node`から直接テストし、既存の除去パターンを壊していないか確認してから反映すること
(位置ベースの経験則のため、閾値を少し変えるだけで挙動が大きく変わりやすい)。

### ランキング表の横幅 (grid itemには`min-w-0`が必須)

`RankingLeaderboard.tsx`のテーブルは`min-w-[520px]`+コンテナに`overflow-x-auto`を付けて、
狭い画面でもテーブル自体の横スクロールだけで収まる(ページ全体は横スクロールしない)設計に
している。以前は`min-w-[640px]`だったが、`Dashboard.tsx`の2カラムgrid
(`lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`)ではランキング側カラムの実効幅が
コンテナ最大幅(`max-w-6xl`)近辺でおよそ636px前後にしかならず、640pxとの差がわずか数pxしか
無かったため、ユーザーの環境で「ランキング表がわずかに横スクロールする」不具合が発生した
(実測: 1152〜1440px幅のいずれでもテーブル実効幅は約636pxで一定。640px境界がほぼ限界値
だった)。値を変更する際は、この2カラムgrid環境での実効幅(すなわち636px前後)を下回ることを
Playwrightで実測して確認すること。

これに加えて、`Dashboard.tsx`のgrid直下の子要素(ランキング側の`<div>`)には**`min-w-0`が
必須**。CSS Gridは子要素の既定`min-width`が`auto`(=中身の最小コンテンツ幅)になるため、
`grid-template-columns`側で`minmax(0, 3fr)`と指定していても、子要素自身が`min-w-0`を
持っていないとテーブルの`min-w-[520px]`のぶんだけgrid自体が横に膨張してしまい
(「grid blowout」と呼ばれる既知のCSS Gridの罠)、モバイル幅(375px相当)で**ページ全体**が
横スクロールする不具合を実際に再現・確認した。`min-w-0`を付けることで、はみ出しは
`RankingLeaderboard`自身の`overflow-x-auto`コンテナ内に閉じ込められる。テーブルを含む
grid item を新設・変更する際はこの`min-w-0`を忘れないこと。

## Vercelデプロイの注意

- プロジェクト: `bqyujiyamada-codes-projects/rakuten-ranking-dashboard` (Hobbyプラン)。本番URL:
  `https://rakuten-ranking-dashboard.vercel.app`
- **初回接続直後、本番URLが全パス404 (`NOT_FOUND`) になる不具合が発生した。** ビルド自体は毎回成功し
  正しいルートがログにも出るため気づきにくいが、原因はVercelプロジェクトの`framework`設定が`null`
  (未検出/Other)になっていたこと。`vercel api /v9/projects/<project> -X PATCH --input <json>` で
  `{"framework":"nextjs"}`をPATCHし、再デプロイ(`vercel --prod`)して解消した。GitHub連携が
  通常のインポート画面を経由せず自動で行われた場合に起こりうるので、再発したら
  `vercel api /v9/projects/<project>` で`framework`フィールドを確認すること。
- Cron Jobs (`vercel.json`)はHobbyプランのため1日1回まで。現在 `0 22 * * *` (UTC) = 毎日7:00 JST に
  `/api/cron/collect`を実行するよう設定・登録済み(`vercel crons ls`で確認可能)。
  **収集・分析ロジック(`src/lib/analysis/`, `src/lib/collectAndAnalyze.ts`等)を変更してpushしても、
  その日のCronが既に実行済みなら反映は翌日7:00 JSTになる。** 「直したはずなのに変わっていない」と
  思ったら、まず該当ジャンルの最新インサイトのtimestampとデプロイ時刻の前後関係を確認すること。
  デプロイ自体が成功しているかは `vercel ls` / `vercel inspect <url>` で確認できる。
- ローカルは`vercel link`済み(`.vercel/project.json`が存在)。`vercel env ls production` /
  `vercel logs <url>` / `vercel inspect <url> --logs` で本番環境変数やログを直接確認できる。

## 開発コマンド

```
npm run dev            # 開発サーバー
npm run build           # 本番ビルド
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run db:create-table # DynamoDBテーブル+GSIを作成 (既存ならスキップ)
```

`.env.local.example` を `.env.local` にコピーし、`RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` /
`GEMINI_API_KEY` / AWS認証情報 / `CRON_SECRET` を設定してから起動する。AWS認証情報が無い状態でも
UI自体は起動するが、DB系APIは500を返す(フロントエンドは空状態にフォールバックする設計)。
Vercel側の環境変数も同じキー名で設定済み(`vercel env ls production`で確認可能)。
