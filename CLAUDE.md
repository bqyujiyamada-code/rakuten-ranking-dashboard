@AGENTS.md

# 楽天ランキング トレンドダッシュボード

楽天ランキングを定期収集・蓄積し、前回スナップショットとの差分をGeminiで分析、
Next.jsダッシュボードで可視化するアプリ。詳細な対応状況は [TODO.md](./TODO.md) を参照。

## 技術スタック

- Next.js (App Router, TypeScript, Tailwind CSS)
- AWS DynamoDB (AWS SDK v3: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`)
- 楽天ウェブサービス Ranking API (`IchibaItem/Ranking/20220601`)
- Google Gemini API (`@google/genai`, モデル `gemini-3-flash-preview`)
- Recharts (グラフ描画)

## ディレクトリ構成と役割

```
scripts/create-table.mjs        DynamoDBテーブル+GSI作成 (npm run db:create-table)
src/lib/config/env.ts           環境変数アクセサ (未設定なら例外を投げる)
src/lib/aws/dynamodb.ts         DynamoDBDocumentClient
src/lib/db/
  keys.ts                       PK/SK/GSIキー生成ロジック (単一テーブル設計)
  types.ts                      DynamoDBアイテムの型定義
  rankingRepository.ts          データアクセス層 (CRUD)
src/lib/rakuten/
  genres.ts                     収集対象「主要中ジャンル」マスタ
  client.ts                     楽天ランキングAPIクライアント
  types.ts                      APIレスポンス/正規化データの型
src/lib/analysis/
  diff.ts                       前回スナップショットとの差分検知
  gemini.ts                     Geminiによるトレンド考察生成
src/lib/collectAndAnalyze.ts    「取得→差分検知→AI分析→保存」のオーケストレーション
src/app/api/
  cron/collect/route.ts         定期収集バッチのエントリポイント
  genres/route.ts, rankings/route.ts, insights/route.ts  ダッシュボード用API
src/components/                 GenreSelector, RankingLeaderboard, RankingChart, InsightCard, Dashboard
```

## DynamoDB 設計 (単一テーブル `RakutenRankings`)

3種類のエンティティをPK/SKパターンで1テーブルに同居させている。

| エンティティ | PK | SK | 用途 |
|---|---|---|---|
| ランキングitem | `GENRE#{genreId}#ITEM#{itemCode}` | `TS#{timestamp}` | 商品ごとの順位・価格の時系列 (`getItemTimeSeries`) |
| GSI1 (上記の別引き) | `GENRE#{genreId}` | `TS#{timestamp}#RANK#{rank}` | ジャンル×時刻の順位表を取得 (`getSnapshotAtTimestamp`) |
| ジャンルメタ | `GENRE#{genreId}#META` | `LATEST` | 直近2回分の収集timestampを保持し、差分検知の基準にする |
| AIインサイト | `GENRE#{genreId}#INSIGHT` | `TS#{timestamp}` | Gemini生成コメント+差分ハイライトの履歴 |

**差分検知の前提**: `collectAndAnalyzeGenre` は「ジャンルメタのlatestTimestamp」を前回スナップショットの
timestampとして扱い、そのタイムスタンプでGSI1を引いて前回の順位表を再構成する。1つの収集バッチ内で
1ジャンルの全商品が同一のtimestamp文字列を共有する前提でチャート側のマージ処理(`RankingChart.tsx`の
`mergeSeries`)も書かれているため、収集バッチのtimestampは**ジャンル単位・バッチ単位で使い回すこと**
(商品ごと・APIコールごとに新しい`Date.now()`を取らない)。ここを崩すと折れ線グラフが点だけになる
(検証時に実際にこの不具合をモックで再現して確認済み)。

## 楽天API利用時の注意

- `TARGET_GENRES` (`src/lib/rakuten/genres.ts`) のgenreIdは代表例。実運用前に楽天ジャンル検索API
  (`IchibaGenre/Search`)で実在確認すること。
- レート制限を考慮し、複数ジャンル取得時はジャンル間で約1.1秒待機している
  (`fetchAllTargetGenreRankings` / `collectAndAnalyzeAllGenres`)。ジャンル数を増やす場合は
  バッチ全体の実行時間がジャンル数に比例して伸びる点に注意。

## 差分検知の閾値

`src/lib/analysis/diff.ts` の `DIFF_THRESHOLDS` で調整する。運用しながらチューニングする想定で、
Geminiに渡すハイライトは最大8件(`MAX_HIGHLIGHTS`)に絞っている。閾値を緩めるとGemini呼び出し
コストが増える点に留意。

## フロントエンド実装で踏んだ制約 (このNext.js/Reactバージョン固有)

このプロジェクトの`eslint-plugin-react-hooks`は通常より厳しいルールが有効になっている。

- **`react-hooks/set-state-in-effect`**: `useEffect`本体の同期的な(awaitより前の)setState呼び出しを
  エラーにする。ローディングフラグは「fetch完了後にsetStateする」か、「取得済みキーとの比較による
  派生値」として表現し、effect起動直後にsetStateしない設計にすること(`Dashboard.tsx`の
  `isLeaderboardLoading`は`loadedGenreId`との比較による派生値)。
- **`react-hooks/refs`**: レンダー中の`ref.current`の読み書きも禁止。前回値を引き継ぐ派生状態
  (例: 商品選択の色割り当て)は、effectやrefで後追い計算せず、**選択操作を行うイベントハンドラの中で
  その場にstateを更新する**方式にすること(`Dashboard.tsx`の`handleToggleItem`を参照)。

`AGENTS.md`にある通りNext.js自体もAPIが学習データと異なる場合があるため、新しい規約を使う前に
`node_modules/next/dist/docs/`を確認する。

## 開発コマンド

```
npm run dev            # 開発サーバー
npm run build           # 本番ビルド
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run db:create-table # DynamoDBテーブル+GSIを作成 (既存ならスキップ)
```

`.env.local.example` を `.env.local` にコピーし、`RAKUTEN_APP_ID` / `GEMINI_API_KEY` /
AWS認証情報 / `CRON_SECRET` を設定してから起動する。AWS認証情報が無い状態でもUI自体は起動するが、
DB系APIは500を返す(フロントエンドは空状態にフォールバックする設計)。
