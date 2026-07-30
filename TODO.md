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

## 未対応 (実運用前に必要)

- [ ] `iam/dynamodb-policy.json` の `<AWS_ACCOUNT_ID>` を実際のアカウントIDに置き換えてIAMポリシーを作成・IAMユーザーにアタッチ(現在のIAMユーザーに実際にこの最小権限ポリシーが適用されているかは未確認)
- [ ] `src/lib/rakuten/genres.ts` のgenreIdは実際のAPI呼び出しで全16件とも正常に動作することを確認済み(実データ取得成功)。ただし正式な `IchibaGenre/Search` によるジャンル名の突合はまだ行っていない
- [x] 2回目以降の自動収集(2026-07-30 7:41 JST実行分)で、差分検知・AIインサイト生成が実際に機能するか確認 → 機能はしたが、生成された分析文・ハイライトの質に問題があり対応16.で修正済み
- [ ] 次回の自動収集(2026-07-31 7:00 JST予定)で、`forecastText`(今後の予測)・日付グラウンディング・
  ハイライト多様化・商品名クリーンアップが実データで意図通り機能するか確認
- [ ] 対応16.で修正した価格Number変換より前に収集済みのレコード(`RankingSnapshotItem.price` / `DiffHighlightRecord.currentPrice`/`previousPrice`)は文字列のまま残っている。バックフィルが必要か検討(実害は今のところ確認されていない)
- [ ] 本番運用を見据えたレート制限・リトライ・監視/アラートの調整
- [ ] (任意) ユニットテスト・E2Eテストの追加
- [ ] (任意) `/api/cron/collect` 以外のAPIルートに対する認可制御の要否検討(現状はダッシュボード表示用に公開)
