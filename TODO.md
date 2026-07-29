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

## 未対応 (実運用前に必要)

- [ ] `npm run db:create-table` を実行し、実際のAWSアカウントにテーブルを作成
- [ ] Vercelにデプロイし、プロジェクトの環境変数(`RAKUTEN_APP_ID` / `GEMINI_API_KEY` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `DYNAMODB_TABLE_NAME` / `CRON_SECRET`)をVercelダッシュボードにも設定する(`.env.local`はローカル専用でVercelには自動連携されない)
- [ ] `iam/dynamodb-policy.json` の `<AWS_ACCOUNT_ID>` を実際のアカウントIDに置き換えてIAMポリシーを作成・IAMユーザーにアタッチ
- [ ] `src/lib/rakuten/genres.ts` のgenreIdを楽天ジャンル検索API (`IchibaGenre/Search`) で実在確認・更新
- [ ] デプロイ後、Vercelダッシュボードで実際にCron Jobsが登録され、初回実行が成功することを確認
- [ ] 実際のAWS認証情報・楽天APIキー・Gemini APIキーを使ったE2E動作確認(ダッシュボードUI自体はモックデータで検証済みだが、実データでの一連の流れは未検証)
- [ ] 本番運用を見据えたレート制限・リトライ・監視/アラートの調整
- [ ] (任意) ユニットテスト・E2Eテストの追加
- [ ] (任意) `/api/cron/collect` 以外のAPIルートに対する認可制御の要否検討(現状はダッシュボード表示用に公開)
