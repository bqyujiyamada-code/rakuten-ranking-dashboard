# TODO

## 対応済み

### 1. プロジェクト基盤
- Next.js (App Router / TypeScript / Tailwind CSS) をscaffold
- 依存追加: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@google/genai`, `recharts`, `date-fns`, `zod`

### 2. DynamoDBアクセス層
- `src/lib/aws/dynamodb.ts`: `DynamoDBDocumentClient` セットアップ
- `src/lib/db/keys.ts`: 単一テーブル設計のキー生成ロジック(ランキングitem / ジャンルメタ / AIインサイトの3種)
- `src/lib/db/types.ts`: DynamoDBアイテムの型定義
- `src/lib/db/rankingRepository.ts`: スナップショット書き込み(25件チャンク+リトライ)、GSI1経由のジャンル×時刻取得、商品別時系列取得、メタアイテムによる前回収集時刻の追跡、AIインサイトのCRUD
- `scripts/create-table.mjs`: `npm run db:create-table` でテーブル+GSIを作成(既存ならスキップ)

### 3. 楽天ランキングAPIクライアント
- `src/lib/rakuten/genres.ts`: 収集対象「主要中ジャンル」マスタ(代表例、要実在確認)
- `src/lib/rakuten/client.ts`: `IchibaItem/Ranking` APIクライアント。レート制限(1.1秒間隔)を考慮した複数ジャンル逐次取得、1ジャンル失敗時も他ジャンルは継続

### 4. 差分検知 & AI分析パイプライン
- `src/lib/analysis/diff.ts`: 前回スナップショットとの差分抽出(新規ランクイン・順位急上昇/下降・値上げ/値下げ)を閾値ベースで検知し、重要度順にソート
- `src/lib/analysis/gemini.ts`: Gemini (`gemini-3-flash-preview`) にトレンド考察コメントを生成させる。実APIキーで疎通確認済み
- `src/lib/collectAndAnalyze.ts`: 「取得→差分検知→AI分析→保存」を1ジャンルずつ実行するオーケストレーション

### 5. APIルート
- `GET /api/genres`: ジャンルマスタ取得
- `GET /api/rankings?genreId=`: 直近の順位表 / `&itemCode=` 付きで商品別時系列
- `GET /api/insights?genreId=`: AIインサイト履歴
- `GET /api/cron/collect`: 定期収集バッチのエントリポイント(`Authorization: Bearer <CRON_SECRET>` で保護)
- いずれもDB/外部API障害時に構造化JSONエラー(500)を返すようtry/catch済み

### 6. ダッシュボードUI
- `GenreSelector` / `RankingLeaderboard`(最大5商品まで比較選択・色スウォッチ) / `RankingChart`(Recharts、順位・価格の2軸チャート、dataviz skillのCVD検証済みパレット準拠) / `InsightCard`(AI分析コメント+差分ハイライトバッジ)
- `Dashboard.tsx` で上記を統合。フェッチ失敗時もクラッシュせず空状態にフォールバック
- Playwright + ヘッドレスChromiumでdevサーバーを起動し、モックAPIレスポンスに差し替えた上でライト/ダークモードのスクリーンショットを撮影し、チャートの折れ線・凡例・カード表示を目視確認済み(検証用の一時ファイルは元に戻し済み)
- `tsc --noEmit` / `eslint` / `next build` はすべてパス

### 7. ジャンルマスタの変更
- `src/lib/rakuten/genres.ts` を「食品・ドリンク関連の中ジャンル(レベル2)」16件に変更(公開情報ベース、要実在確認は継続)

### 8. 認証情報・IAM
- `.env.local` / `.env.local.example` に `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` を直接記載する方式に変更(このユーザーの他プロジェクトでの慣習に合わせた)
- `iam/dynamodb-policy.json`: `RakutenRankings`テーブル+GSIのみに絞った最小権限IAMポリシー(CreateTable/DescribeTableとGetItem/PutItem/BatchWriteItem/Query)を作成
- `.env.local` に実際の `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `RAKUTEN_APP_ID` / `GEMINI_API_KEY` を設定済み

### 9. Vercelでの定期実行スケジューリング
- デプロイ先はVercel (Hobbyプラン) に決定
- `vercel.json` に Cron Jobs 設定を追加 (`/api/cron/collect` を毎日 22:00 UTC = 7:00 JST に実行)
- `src/app/api/cron/collect/route.ts` に `export const maxDuration = 300` を追加(Hobbyでも上限300秒まで設定可能なことを確認済み)
- Vercel Cron Jobsはプロジェクトに `CRON_SECRET` 環境変数が設定されていれば自動的に `Authorization: Bearer <CRON_SECRET>` ヘッダーを付与してくれる仕様のため、既存の認可ロジックがそのまま使える
- Hobbyプランの制約としてCronは1日1回までのため、差分検知・AI分析も日次粒度になる想定
- `vercel crons ls` でVercel側にも実際に登録されていることを確認済み

### 10. Vercel本番デプロイの404障害対応
- GitHub連携直後の本番URLがすべて404 (`NOT_FOUND`) になる不具合が発生
- 原因はVercelプロジェクトの `framework` 設定が `null`(未検出)になっていたこと。`vercel api /v9/projects/rakuten-ranking-dashboard -X PATCH` で `framework: "nextjs"` に修正し、再デプロイして解消
- 修正の経緯・再発時の対処法は `CLAUDE.md` に記録済み

### 11. DynamoDBテーブルの実作成
- `npm run db:create-table` を実行し、実際のAWSアカウント (ap-northeast-1) に `RakutenRankings` テーブル + `GSI1_GenreTimestamp` を作成・`ACTIVE`であることを確認済み

### 12. 楽天API 2026年インフラ移行への対応
- 収集バッチを実行したところ全ジャンルが `503 under maintenance` で失敗 → 実際は一時メンテナンスではなく、楽天API基盤が新ドメインへ全面移行済み(旧 `app.rakuten.co.jp` は実質廃止)だったことが原因と判明
- ユーザーが楽天ウェブサービスで新方式のアプリを再登録し、新しい `applicationId` / `accessKey` を発行
- コード側 (`src/lib/rakuten/client.ts`, `src/lib/config/env.ts`) を新エンドポイント・新認証方式に対応させ、`.env.local` / Vercel環境変数の両方に `RAKUTEN_ACCESS_KEY` を追加
- 詳細な技術的注意点(Referer/Origin必須、period=realtime必須など)は `CLAUDE.md` に記録済み

### 13. 実データでのE2E動作確認
- 移行対応後、`/api/cron/collect` を本番で実行し、全16ジャンル(各29〜30件)の実データ取得・DynamoDB保存・`/api/rankings` からの読み出しまで一気通貫で成功を確認
- 初回収集のため差分・AIインサイトはまだ生成されていない(2回目以降の収集で発生する想定)

### 14. ダッシュボードUIのユーザビリティ改善
- 商品名(60〜100文字超)をチェックボックスで選択するとRechartsの`<Legend>`が折り返し放題になりテーブルと重なって崩れる不具合を修正
- `RankingChart.tsx`: Recharts標準Legendを廃止し、省略表示+クリックで選択解除できる独自チップ形式の凡例に変更
- `RankingLeaderboard.tsx`: 30件表示でも際限なく伸びないよう `max-h-520px` でスクロール可能にし、ヘッダー行を固定
- `Dashboard.tsx`: グラフを左カラムの狭い幅から出し、ランキング表+AIインサイトの下に全幅で配置
- 本番環境をPlaywrightで実際に操作し、ライト/ダークモード両方・スクロール動作まで確認済み

### 15. AIトレンド分析に「今後の予測」を追加
- `src/lib/analysis/gemini.ts`: Gemini呼び出しを`responseSchema`による構造化JSON出力に変更し、
  `trendAnalysis`(直近の変動考察)と`forecast`(今後ランクインしてきそうな商品傾向の予測)の
  2フィールドを1回の呼び出しで生成するように変更(`TrendInsightResult`型)
- `src/lib/db/types.ts` / `rankingRepository.ts`: `InsightItem`に`forecastText`(任意)を追加。
  既存の過去インサイトレコードには存在しないため optional にしてある
- `src/app/api/insights/route.ts`: レスポンスに`forecastText`(無ければ`null`)を追加
- `InsightCard.tsx`: `forecastText`がある場合のみ「🔮 今後の予測」ブロックを表示
- 予測は個別の未発売商品名を断定しないよう、カテゴリ・価格帯・訴求ポイントなど「傾向」として
  述べるようプロンプトで指示している

### 16. 実データによるAI分析品質のレビューと改善
本番の実収集データ(2026-07-29 03:38 → 22:41 JSTの2回目収集、全16ジャンル)を直接確認したところ、
以下の問題を発見・修正した。

- **価格が文字列型で保存されるバグ**: 2026年移行後の新楽天APIは`itemPrice`を文字列で返すことがあり、
  `client.ts`側でNumber変換していなかったため`RankingItem.price`(型はnumber)の実態が文字列に
  なっていた。`Number(Item.itemPrice)`で変換するよう修正(`rakuten/types.ts`の型注釈もコメントで明記)。
  **注意: 修正前に収集済みの過去レコードは文字列のまま残っている**(バックフィルは未実施)。
- **AI分析文が「お中元」一色になる問題**: 16ジャンル中13ジャンルの分析文が判で押したように
  「お中元シーズン」を主要因に挙げており、季節の進み具合の表現(目前/最盛期/本格化)もジャンルごとに
  矛盾していた。原因は`gemini.ts`のプロンプトに現在日付を渡しておらず、商品名に含まれる販促・SEO
  キーワード("お中元"等)にGeminiが引っ張られていたため。プロンプトに本日の日付(JST)を明示し、
  「商品名の販促キーワードを時期的妥当性を無視して鵜呑みにしない」「データから読み取れる範囲を
  超えた物語を作らない」旨の注意書きを追加。
- **差分ハイライトが新規ランクインに偏る問題**: DynamoDBの実データを確認すると、period=realtimeの
  性質上、前回スナップショットとの商品重複率がジャンルによっては0/30〜20/30件と非常に低く、
  上位30件がほぼ総入れ替わりすることがある。旧ロジックは新規ランクインの重要度を常に最優先する
  ため、こうした高回転ジャンルでは8枠の highlight が全部NEW_ENTRYで埋まり、ランク上昇/下降・
  価格変動が highlight から漏れていた(実測で12/16ジャンルが8件中8件NEW_ENTRY)。
  `diff.ts`に`MAX_NEW_ENTRY_HIGHLIGHTS`(4件)を導入し、新規ランクインの採用数に上限を設けて
  他タイプの枠を確保するよう変更(`selectDiverseHighlights`)。
- **ハイライトバッジの見やすさ改善**: `InsightCard.tsx`のバッジがラベル+商品名のみで、実際の
  順位・変動幅はhoverの`title`でしか見えなかった。`movementLabel()`を追加し、「3位」「12→3位」
  「-15%」のような変動を常時バッジ内に表示するよう変更。

### 17. グラフの動作確認 & 商品名の表示クリーンアップ
Playwright(ヘッドレスChromium)で本番DBに繋いだdevサーバーを操作し確認。

- **グラフ自体は正常**: 価格が文字列型だった旧データでも軸・線は問題なく描画されていたが、
  対応16.のNumber変換以降は数値として正しく扱われる。収集回数がまだ2回のため大半の商品は
  点1つのみ(線を引くには最低2点必要)。データが溜まるにつれ折れ線が増えていく想定で、
  現状は仕様通り。
- **商品名冒頭の販促文言が視認性を下げる問題に対応**: 楽天の商品名は「今夜23:59まで
  ポイント10倍！お試し送料無料2,490円～」のように販促・SEO文言が冒頭に付くことが多く、
  truncate表示だと肝心の商品名が見えないケースが多数あった(実データ473件中約4割で発生)。
  `src/lib/format/itemName.ts`に`displayItemName()`を追加し、`RankingLeaderboard` /
  `RankingChart`(凡例・ツールチップ) / `InsightCard`(ハイライトバッジ) の表示名に適用。
  正規表現ベースの経験則であり完全ではない(まれに削りすぎ/削り足りない)。元の`itemName`は
  一切変更せず、hoverの`title`で常に確認できる。
- ついでに`RankingChart`のツールチップに価格の桁区切り表示(`Intl.NumberFormat`)を追加。

### 18. 対応15〜17のコミット・本番デプロイ
- コミット `0d9dcfd`("Add AI forecast insight and fix data quality issues found in production review")を
  `main` にpush済み。Vercelが自動ビルド・デプロイし、`rakuten-ranking-dashboard.vercel.app` の
  エイリアスが新デプロイ(`dpl_AqUBjxF3sEtRF8odLqQsrPQgkMYi`)に切り替わったことを`vercel inspect`で確認済み
- Cronは `0 22 * * *`(UTC)= 毎日7:00 JST。2026-07-30 7:41 JSTの収集は本コミット反映前に実行済みのため、
  `forecastText`を含む新ロジックが実際に使われるのは**次回の自動収集(2026-07-31 7:00 JST予定)から**
- 過去に保存済みのインサイト(今回分含む)には`forecastText`は付与されない。付与されるのは
  デプロイ後に新規生成されたインサイトのみ

### 19. AI分析の前回比連続性 & インサイト表示のレイアウト改善
ユーザーから「AIトレンド分析が最大5件並ぶと縦長すぎて見づらいのでは」「前回と今回の単純比較にしか
なっておらず長期的な分析ができないのでは」という2点の指摘を受け対応した。

- **前回分析との連続性**: `collectAndAnalyzeGenre`で、実装済みだが未使用だった`getLatestInsight()`を
  呼び出して前回のインサイト(`aiAnalysisText`/`forecastText`)を取得し、`generateTrendInsight`
  (`src/lib/analysis/gemini.ts`)に`previousInsight`として渡すよう変更。プロンプトに「前回分析
  (参考・連続性のため)」セクションを追加し、前回の文章をそのまま繰り返さず、今回の変動が前回の
  続きか・方向転換か・変化なしかを意識して書くよう指示している。なお、これは飽くまで「前回比との
  連続性」を持たせる軽量な対応であり、週次/月次のロールアップ集計のような本格的な長期・季節分析
  はまだ実装していない(将来の課題として検討中)。
- **インサイト表示の縦長問題**: `Dashboard.tsx`は`/api/insights`から最新5件を取得して
  `InsightCard`を縦に並べているが、実データ(1件あたり分析文+予測文+ハイライトバッジ最大8件)で
  実際に見てみたところ、2件の時点で既にランキング表より縦に長く、5件分をモックで再現すると
  ページ全体が約3900pxまで伸びることをPlaywrightのスクリーンショットで確認した(検証用の一時
  ファイルは元に戻し済み)。`InsightCard.tsx`をネイティブの`<details>`/`<summary>`によるアコー
  ディオン形式に変更し、**最新1件のみ展開状態**(`open={isLatest}`)、**過去分は折りたたみ**
  (日時+分析文の一行プレビューのみ)にしてクリックで個別展開できるようにした。結果、5件表示時の
  ページ高さはランキング表と同程度(約1080px)まで縮小。ライト/ダークモード・クリック展開の動作を
  Playwrightで確認済み。

### 20. 変動ハイライトのランキング表への統合 & グラフの単一商品化

ユーザーから「分析欄の変動ハイライトをランキング表側にまとめられないか」「グラフは複数商品比較
ではなく単一商品の順位・価格推移を1枚のグラフに重ねて表示したい」という2点の要望を受け対応した。

- **変動ハイライトの移設**: `InsightCard.tsx`にあった新規ランクイン/順位急変/値上げ・値下げの
  バッジ表示を廃止し、`RankingLeaderboard.tsx`の各行に「変動」列として表示するよう変更。
  バッジのラベル・色定義(`HIGHLIGHT_META`)と変動幅の文字列化(`movementLabel`)は両コンポーネント
  から使えるよう`src/lib/format/highlight.ts`に切り出した。`Dashboard.tsx`は最新1件のインサイト
  (`insights[0]`)のみから`itemCode`引きのMapを作りランキング表に渡す(過去分のハイライトは
  現在の順位表と対応しないため使わない)。`InsightCard`は分析文+予測文のみを表示するようになった。
- **グラフの単一商品化**: `RankingLeaderboard`の選択列をcheckbox(最大5件)からradio(1件)に変更し、
  `Dashboard.tsx`の状態も`selectedItemCodes`/`colorAssignments`(複数商品の色割り当て)を廃止して
  `selectedItemCode: string | null`のみに簡略化した。
- **グラフの結合**: `RankingChart.tsx`を「順位の推移」「価格の推移」の2枚のグラフから、
  1枚のグラフに`yAxisId`で分けた2本のライン(順位=`var(--series-1)`、価格=`var(--series-2)`)を
  重ねる形に変更。順位軸(左, `reversed`)と価格軸(右)で独立したスケールを持たせている。
  凡例は商品ごとの色分け(クリックで比較から除外)から、「順位」「価格」の指標を示す固定の
  凡例(`MetricLegend`)に変更。選択解除はグラフ見出し右の「選択解除」ボタンで行う。
- Playwright(ヘッドレスChromium、モックAPIレスポンス)でライト/ダークモード・商品選択後の
  表示を確認し、`tsc --noEmit` / `eslint` / `next build` がパスすることも確認済み。

### 21. ランキング表示用ハイライトとGemini用ハイライトの分離

対応20.でランキング表の「変動」列にハイライトを表示するようにしたところ、ユーザーから
「1〜30位全件に表示されるようになったか」との確認があり、実際には`selectDiverseHighlights`
(Geminiに渡す件数を絞る目的で元々あったロジック)が保存データ自体にも掛かっていたため、
最大8件・新規ランクインは最大4件までしか表示されないことが判明した。さらに「ランキング表示用と
Gemini用のハイライトを分離すべきでは」という指摘を受け、以下の設計変更を行った。

- `src/lib/analysis/diff.ts`: `detectDiffHighlights`を、閾値(`DIFF_THRESHOLDS`)を超えた変化を
  **件数上限なしで全件返す**よう変更(戻り値はランキング表の「変動」列がそのまま使う)。
  従来ここに内包されていた8件キャップ+新規ランクイン多様性ロジックは`selectHighlightsForGemini`
  という別関数に切り出してexportし、Gemini呼び出し側でのみ使うようにした。
- `src/lib/collectAndAnalyze.ts`: `collectAndAnalyzeGenre`で、`detectDiffHighlights`の全件を
  `putInsight`(DynamoDB保存 = ランキング表・API表示用)にそのまま渡す一方、Gemini呼び出し
  (`generateTrendInsight`)には`selectHighlightsForGemini(highlights)`で絞り込んだ部分集合のみ
  渡すよう分離した。
- 動作確認: `node --experimental-strip-types`でdiff.tsを直接実行し、新規ランクインのみ30件中
  該当10件の局面で全件版が10件・Gemini版が8件(新規ランクインで空き枠を埋める既存仕様通り)、
  各変動タイプが6件ずつ混在する局面で全件版が30件・Gemini版が8件(うち新規ランクインは上限の
  4件)になることを確認済み。
- `tsc --noEmit` / `eslint` / `next build` はパス。Gemini呼び出し自体は本番の次回自動収集
  (Cronは1日1回)まで実データでの確認はできていない。

### 22. 気象データ・世間のトレンドを統合したクロス分析への拡張

ユーザーから「気象データ」と「世間のトレンド」をAI分析に統合し、因果関係の深掘りと
将来予測の精度を高めたいという要望を受け、以下を実装した。設計提案は事前にユーザーと
すり合わせ、気象データは東京を代表地点(推奨案採用)、トレンドはGemini自身にGoogle検索
させて要約させる方式(推奨案採用、新規API契約なし)で進めた。

- **タイムラグの扱い**: 「7時収集のランキングは前日の消費行動が反映された結果」という
  ユーザーの前提に基づき、`causalDate = 収集日(JST) - 1日`を気象・トレンドの対象日として
  紐づける設計にした。Open-Meteoの`past_days`は確定済みの実測値を返すため、当初想定されて
  いた「夜間の追加バッチ」は不要と判断し、既存の7時Cron 1本(Hobbyプランの1日1回制約内)に
  完結させた(詳細はCLAUDE.md参照)。
- **新規モジュール**: `src/lib/date/jst.ts`(JST暦日ユーティリティ、`gemini.ts`にあった
  日付整形ロジックをここに集約)、`src/lib/weather/openMeteo.ts`+`weatherCode.ts`(東京の
  日次気象取得、APIキー不要)、`src/lib/analysis/trendSummary.ts`(Gemini Google Search
  groundingで世間のトレンドを要約。既存の構造化JSON出力の呼び出しとはツール制約により
  別関数に分離)。
- **DBスキーマ拡張**: `WEATHER#{date}` / `TREND#{date}` (気象・トレンドを実際の対象日
  そのものをキーに独立した時系列として蓄積) と、ランキング収集日から`timestamp`/
  `causalDate`を引ける`DAY#{date}`索引を追加。日付一覧取得用に新設した
  `GSI2_DailyBundle`は`scripts/create-table.mjs`で追加(既存テーブルには`UpdateTable`で
  後付け、GSI ACTIVE化をポーリング待機)。
- **収集フロー(`collectAndAnalyze.ts`)**: 気象・トレンドの取得をジャンルループの外に出し、
  収集バッチ全体で1回だけ取得・キャッシュしてから全ジャンルのGemini呼び出しに使い回す
  (ジャンルごとに16回呼ぶ無駄を回避)。取得失敗時はnullを許容し、収集自体は継続する。
- **Geminiプロンプト(`gemini.ts`)**: 出力フィールドは`trendAnalysis`/`forecast`のまま増やさず、
  気象・トレンド情報をプロンプトに追加した上で「データから合理的に説明できる関連があれば
  因果関係に触れる/薄ければ無理にこじつけない」旨を指示。
- **API/UI**: `/api/rankings`・`/api/insights`に`&date=`を追加(既存の最新表示動作とは
  完全後方互換)。新規`/api/dates`(日付一覧)・`/api/daily-context`(判断材料表示用)を追加。
  `Dashboard.tsx`に`HistoryDatePicker`を追加し、過去日付選択でランキング・AI分析・
  気象/トレンドパネルを一式で切り替え可能にした。
- **動作確認**: `tsc --noEmit`/`eslint`/`next build`はパス。Playwright(ヘッドレスChromium)で
  実DB接続のdevサーバーを操作し、ライト/ダークモードで既存機能(ジャンル切り替え・
  ランキング表・AIインサイトのアコーディオン)に回帰がないこと、新機能が未提供時(後述の
  IAM未対応)でもクラッシュせずグレースフルに非表示になることを確認。さらにAPIレスポンスを
  モックした状態で日付ピッカー・判断材料パネルの表示、過去日付選択時の空状態フォールバックが
  正しく機能することも確認した(検証用の一時ファイルは元に戻し済み)。
- **本番のIAM権限が未対応(要対応)**: 実装中に本番DynamoDBへ`GSI2_DailyBundle`を追加しようと
  したところ、現在IAMユーザー`rakuten_ranking_api`にアタッチ済みの最小権限ポリシーが
  `dynamodb:UpdateTable`を許可していないため`AccessDeniedException`で失敗した。
  `iam/dynamodb-policy.json`は「Setup」ステートメントに`UpdateTable`を追加し「Runtime」
  ステートメントに`GSI2_DailyBundle`のARNを追加する形で更新済みだが、**このJSONを実際に
  AWSのIAMポリシーとして更新・適用するのはユーザー側の対応が必要**(IAM変更は本セッションでは
  実行していない)。適用後に`npm run db:create-table`を再実行すればGSI2が追加され、
  `/api/dates`・`/api/daily-context`・日付ピッカーが実際に機能するようになる。

### 23. 対応22.の本番デプロイ・GSI2の実運用反映・過去データのバックフィル

- コミット`ada2ca8`("Integrate weather and social trend data into AI analysis, add
  historical date browsing")を`main`にpush済み。Vercelが自動ビルド・デプロイし、
  `rakuten-ranking-dashboard.vercel.app`のエイリアスが新デプロイ(`dpl_629vspZTqWr1zpg3tk5Xzj8AV1Cn`)
  に切り替わったことを`vercel inspect`で確認済み。
- ユーザーがIAMポリシーを更新(`UpdateTable`権限+`GSI2_DailyBundle`のARNへの`Query`権限)、
  `npm run db:create-table`で本番テーブルに`GSI2_DailyBundle`を追加し`ACTIVE`化を確認済み。
- **過去データのバックフィル**: この機能を導入する前(7/29〜8/4)に収集済みだったランキング・
  インサイトについては、`DAY#{date}`索引(日付ピッカーの起点)が存在せず、当時の気象データも
  未取得だった。`scripts/backfill-daily-context.mjs`(dry-run既定、`--apply`で書き込み)を
  新規作成し、以下を実施:
  - 全16ジャンルのGSI1を走査して実際に収集が行われたバッチのtimestampを収集日(JST)ごとに
    グルーピングし、`DAY#{date}`索引を復元(`timestamp`はランキング/インサイトの既存データ
    から完全に復元可能、情報の欠落なし)。
  - 各`causalDate`についてOpen-Meteoから気象データを取得し`WEATHER#{causalDate}`として保存
    (Open-Meteoの過去実測値は遡って取得可能なため、これも欠落なく復元可能)。
  - **世間のトレンド(`TREND#`)は意図的にバックフィル対象外にした**。Geminiの検索grounding
    は「今の検索結果」しか見られず、過去日について聞いても当時のリアルタイムなトレンドは
    再現できない(後知恵の要約になる)ため、データから読み取れる範囲を超えた物語を作らない
    という既存方針(対応16.)に反すると判断した。UIは`trend=null`を許容する設計のため、
    過去分の判断材料パネルは気象情報のみ表示され、トレンド部分は単に非表示になる。
  - 本番で`--apply`実行し、7件の収集日(2026-07-29〜08-04)すべてに`DAY#`・`WEATHER#`を
    書き込み済み。本番の`/api/dates`・`/api/daily-context`をcurlで、日付ピッカー選択後の
    表示をPlaywright(実際の本番URL)でそれぞれ確認し、実データで正しく機能することを確認済み
    (最初の収集日である7/29はまだ差分検知対象がなくAIインサイトが無いため「まだ有意な変動が
    検知されていません」と表示されるのも仕様通り)。

### 24. 表示日ナビゲーションをプルダウンから矢印+日付入力に変更

対応22.で追加した日付ピッカーについて、ユーザーから「収集が続くと選択肢が無限に増えて
プルダウンとしてUX上よろしくないのでは」との指摘を受け対応した。収集は1日1回のため
`/api/dates`はデフォルト90件に絞ってはいたが、フラットな`<select>`で90件はそもそも
使いにくいと判断。

- `HistoryDatePicker.tsx`を、全件を並べる`<select>`から「◀/▶でデータのある前後の日へ移動」+
  「ネイティブの`<input type="date">`で任意の日にジャンプ(`min`/`max`を最古/最新の収集日に
  制限)」の組み合わせに変更。件数が増えてもUIの見た目・操作感が変わらない。
- ◀/▶は隣接indexではなく大小比較(`dates.find(d => d.date < currentDate)`等)で
  「データが存在する前後の日」を探すようにしており、日付入力で意図的にデータの無い日
  (収集が失敗した日など)を選んだ場合でも、そこから最寄りのデータがある日へ正しく移動できる。
- 現在地が最新でない場合のみ「最新に戻る」ボタンを表示。
- ローカル(Playwright、本番DBに接続)で◀/▶移動・`min`/`max`によるクランプ・
  「最新に戻る」の動作を確認済み。`tsc --noEmit`/`eslint`もパス。

### 25. インサイト表示の単純化 & ランキング表の横スクロール不具合修正

ユーザーから2点の指摘を受け対応した。

- **「表示日当日以外の分析は表示させなくていい」**: 対応22./24.で表示日ピッカーにより
  任意の過去日へ遡れるようになったため、`InsightCard`側で複数日分(直近5件)をアコーディオンで
  積み重ねて見せる従来設計(対応19.)が不要になった。`Dashboard.tsx`のインサイト取得を
  常に`&limit=1`(最新表示時)または`&date=`(過去日表示時)の1件のみに変更し、
  `InsightCard.tsx`は`<details>`アコーディオンをやめて常時展開の単一カードに単純化した
  (`isLatest`props・「最新」バッジも不要になったため削除)。
- **「ランキング表示がデフォルトでわずかに横スクロールする」**: 原因は`RankingLeaderboard.tsx`
  の`min-w-[640px]`が、`Dashboard.tsx`の2カラムgrid(3:2)でのランキング側カラムの実効幅
  (`max-w-6xl`環境下でおよそ636px)とほぼ同じで、わずか数px上回っていたため。Playwrightで
  1152〜1440px幅の実測を行い`640px`→`520px`に調整して解消を確認。あわせて、grid直下の
  子要素に`min-w-0`が無いと(CSS Gridの既定`min-width:auto`により)テーブルの`min-w`分だけ
  grid自体が横に膨張し、モバイル幅で**ページ全体**が横スクロールする別の不具合(grid blowout)
  も発見・修正した(`min-w-0`をランキング側のgrid item divに追加。修正後はテーブル自身の
  `overflow-x-auto`内にのみはみ出しが収まることをPlaywrightで確認)。詳細な数値・再発防止の
  指針はCLAUDE.md参照。
- `tsc --noEmit`/`eslint`はパス。Playwright(ローカル、本番DB接続)でライト/ダークモード・
  複数のビューポート幅(1152/1200/1280/1366/1440/375px)での表示を確認済み。

### 26. 2026-08-05 Cronタイムアウト障害の復旧 & 再発防止

2026-08-05 7:07 JSTの自動収集が、Gemini API高負荷(`503`)を契機にVercelの300秒実行時間上限
(Hobbyプラン)を使い切り、1ジャンルも処理できないままタイムアウトする障害が発生した。

- **復旧**: `CRON_SECRET`で`/api/cron/collect`を手動で計3回実行(1回目0ジャンル完走、2回目
  16ジャンル中11ジャンル完走で再度タイムアウト、3回目で全16ジャンル完走・`putDailyBundle`まで
  到達し`/api/dates`に本日分が登録されたことを確認)。3回目の実行時点でもGeminiの高負荷は
  完全には収まっておらず、`100283`/`201136`/`100317`/`100337`の4ジャンルはランキングデータは
  取得できたもののAI分析(トレンド考察・予測)の生成に失敗していた。この4ジャンルについては、
  ランキング再取得・`GenreMeta`更新を伴わず「既存の最新スナップショットに対してGemini分析
  だけを再試行してDBに保存する」一時的な管理用APIルートを作成し、ローカルdevサーバー
  (本番DynamoDB接続)経由で実行して復旧した。作業完了後、このルートはローカルのみで実行し
  コミットせず削除済み(本番環境には一切変更なし)。
- **根本原因**: `@google/genai`のSDKは既定で1回のAPI呼び出しにつき最大5回・指数バックオフ付きの
  自動リトライを行う。`fetchDailyTrendSummary`(トレンド要約、ジャンルループの外で1回だけ呼ぶ)
  がこのリトライだけで300秒予算をほぼ使い切り、後続の16ジャンルループにほとんど時間が
  残らなかった。呼び出し自体は`try/catch`で失敗を握りつぶす設計だったが、リトライに要する
  時間そのものはtry/catchでは短縮できず、対策として不十分だった。
- **再発防止**: `src/lib/analysis/gemini.ts`の`generateTrendInsight`・
  `src/lib/analysis/trendSummary.ts`の`fetchDailyTrendSummary`双方の`generateContent`呼び出しに
  `config.httpOptions`で明示的なタイムアウト(`generateTrendInsight`は12秒、
  `fetchDailyTrendSummary`は20秒)と`retryOptions.attempts: 1`(リトライ無し)を設定した。
  300秒予算から楽天API呼び出し分(概算70秒)を差し引いた約230秒を、トレンド要約1回+
  ジャンルごとの分析呼び出し最大16回(計17回)で分け合う計算に基づく値。リトライを敢えて
  無効化しているのは、短いタイムアウト+SDK既定リトライの組み合わせだと「タイムアウト×
  試行回数」分の時間を結局消費し同じ問題が再発するため。失敗時の救済は既存の
  ジャンル単位`try/catch`(該当ジャンルのみAI分析スキップ、翌日の自動収集または手動再実行に
  委ねる)にそのまま任せている。詳細な設計判断・予算計算はCLAUDE.md参照。
- `tsc --noEmit` / `eslint`はパス。本番への再デプロイ・実データでのタイムアウト再発有無の
  確認はまだ行っていない(次回以降の自動収集、またはGemini高負荷時の再現待ち)。

### 27. 差分ハイライトの保存をGemini分析の成否から独立させ、長期分析への布石とした

ユーザーから「1年分など長期でデータが溜まった際に季節性・長期トレンド・時世のトピックを
分析できるか、今のデータに何か加える必要があるか」と問われたのを機に設計を見直した。

- 結論として、日次の生データ(ランキング・気象・トレンド要約)自体は削除されず蓄積され続ける
  ため長期分析の材料にはなるが、**長期・季節トレンドを実際に分析する機能(週次/月次ロールアップ
  +専用のGemini呼び出し)は未実装**であり、これは対応19.以来の既知の課題として残っている
  (今回は着手していない)。
- ただし調査の過程で、差分ハイライトが**Gemini分析成功時にしか保存されない**というデータ
  完全性の穴を発見した(対応26.のCronタイムアウト障害で実際にこの穴が顕在化していた)。
  長期分析はこのハイライトの生データ(値上げ/値下げ件数・新規ランクイン数などの月次集計)を
  主な材料にする想定のため、まずこの穴を塞ぐことを優先した。
- `src/lib/db/types.ts`: 差分ハイライトを`InsightItem`から独立させ、新規`DiffHighlightsItem`
  (`GENRE#{genreId}#HIGHLIGHTS` / `TS#{timestamp}`)エンティティに変更。
- `src/lib/collectAndAnalyze.ts`: `collectAndAnalyzeGenre`で、差分検知ができた時点(Gemini
  呼び出しの前)に`putHighlights`を必ず呼ぶよう変更。`putInsight`はAI分析テキストのみを
  保存する形に縮小。
- `src/app/api/insights/route.ts`: 全面書き換え。「その日の収集バッチのtimestamp」を
  (dateありなら`DAY#`バンドル、最新表示なら`GenreMeta.latestTimestamp`から)先に解決し、
  AI分析とハイライトを独立に取得してマージする方式に変更。以前の`listInsights`ベースの
  「最新」解決だと、当日Geminiが失敗した際に前日のInsightItemへ誤ってフォールバックし
  当日のランキングと噛み合わないハイライトを表示しかねなかったため、`listInsights`自体を
  削除した。あわせて未使用だった`limit`パラメータも廃止(常に最大1件を返す設計に統一)。
- `src/components/InsightCard.tsx` / `Dashboard.tsx`: `InsightData.aiAnalysisText`を
  `string | null`に変更し、(1)変動なし (2)変動検知したがAI分析文なし(Gemini失敗)
  (3)AI分析文あり、の3状態を描画するよう対応。
- 過去(この対応より前)に書き込まれたInsightItemには`highlights`が埋め込まれたまま残っている
  ため、`/api/insights`は新エンティティが見つからない場合のみInsightItem側にフォールバックする
  後方互換を入れている(バックフィルは実施せず)。
- `tsc --noEmit` / `eslint` / `next build`はパス。ローカル(本番DynamoDB接続)で、最新表示・
  過去日表示・ハイライト0件・AI分析文欠落(モック)の4パターンをPlaywrightで確認済み。
  本番デプロイはこれから。

## 未対応 (実運用前に必要)

- [x] `iam/dynamodb-policy.json`の内容(`UpdateTable`権限+`GSI2_DailyBundle`のARN)を
  ユーザーが実際のIAMポリシーとして`rakuten_ranking_api`ユーザーに適用済み。
  `npm run db:create-table`で本番テーブルに`GSI2_DailyBundle`を追加し`ACTIVE`化を確認済み
  (対応23.)
- [x] 対応22.のコードをVercel本番にデプロイ済み(対応23.)。過去分のバックナンバー
  (`DAY#`/`WEATHER#`)もバックフィル済みで、日付ピッカー・判断材料パネルが本番で実データ表示
  されることを確認済み(対応23.)
- [ ] 次回以降の自動収集(Cronは1日1回)で、東京の気象データ・Geminiのトレンド要約が
  新規に正しく取得・保存され、AI分析文に因果関係の言及が反映されるかを実データで確認
  (バックフィルは気象のみで、トレンドは今後の収集分から新規に蓄積される)
- [ ] 次回以降の自動収集で、前回分析文をGeminiプロンプトに含める連続性機能(対応19.)が実データで
  意図通り機能するか(同じ内容の繰り返しになっていないか等)確認
- [ ] (任意・将来的な検討事項) 週次/月次のロールアップや季節性を踏まえた長期トレンド分析の実装
  (対応19.で指摘された、現状は前回比の単純比較にとどまっている点への本格対応)
- [ ] `src/lib/rakuten/genres.ts` のgenreIdは実際のAPI呼び出しで全16件とも正常に動作することを確認済み(実データ取得成功)。ただし正式な `IchibaGenre/Search` によるジャンル名の突合はまだ行っていない
- [x] 2回目以降の自動収集(2026-07-30 7:41 JST実行分)で、差分検知・AIインサイト生成が実際に機能するか確認 → 機能はしたが、生成された分析文・ハイライトの質に問題があり対応16.で修正済み
- [ ] 次回の自動収集(2026-07-31 7:00 JST予定)で、`forecastText`(今後の予測)・日付グラウンディング・
  ハイライト多様化・商品名クリーンアップが実データで意図通り機能するか確認
- [ ] 対応16.で修正した価格Number変換より前に収集済みのレコード(`RankingSnapshotItem.price` / `DiffHighlightRecord.currentPrice`/`previousPrice`)は文字列のまま残っている。バックフィルが必要か検討(実害は今のところ確認されていない)
- [ ] 本番運用を見据えたレート制限・リトライ・監視/アラートの調整
- [ ] (任意) ユニットテスト・E2Eテストの追加
- [ ] (任意) `/api/cron/collect` 以外のAPIルートに対する認可制御の要否検討(現状はダッシュボード表示用に公開)
- [ ] 次回の自動収集で、対応21.の変更(ランキング表示用ハイライトの全件化・Gemini用ハイライトの
  分離)が実データで意図通り機能するか確認(ランキング表の「変動」列が8件超のジャンルで
  実際に増えるか、Geminiへの分析結果に悪影響が出ていないか)
- [x] 対応26.のGemini呼び出しタイムアウト対策(`gemini.ts`/`trendSummary.ts`)をコミット・
  Vercel本番にデプロイ済み(`vercel ls`でReadyを確認)。ただし本番の**自動**Cron
  (次回は翌7:00 JST予定)でタイムアウトが再発しないかは、次回以降の自動実行でまだ未確認
  (このセッション中に確認したのは手動再実行のみ)
- [ ] 対応27.(差分ハイライトとGemini分析の分離)をコミット・Vercel本番にデプロイする。
  デプロイ後、次回以降の自動収集で(a)ハイライトが差分検知のたびに毎回保存されるか
  (b)万一Gemini分析が失敗した日でもランキング表の「変動」列・`/api/insights`のハイライトが
  空にならないか、を実データで確認する
