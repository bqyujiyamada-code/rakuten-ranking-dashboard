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

## 差分検知の閾値とハイライトの多様性

`src/lib/analysis/diff.ts` の `DIFF_THRESHOLDS` で調整する。運用しながらチューニングする想定で、
Geminiに渡すハイライトは最大8件(`MAX_HIGHLIGHTS`)に絞っている。閾値を緩めるとGemini呼び出し
コストが増える点に留意。

楽天のリアルタイムランキング(`period=realtime`)は母数の小さいジャンルほど日次の総入れ替わりが
激しく、実データでは前回スナップショットとの商品重複が0/30〜20/30件程度まで落ち込むことがある。
新規ランクインの重要度を無条件に最優先すると、こうした高回転ジャンルで8枠が全部NEW_ENTRYに
占有され、ランク上昇/下降・価格変動のハイライトが出てこなくなる(実際に本番データでこの現象を
確認済み)。そのため`MAX_NEW_ENTRY_HIGHLIGHTS`(現在4件)で新規ランクインの採用数に上限を設け、
残り枠を他タイプに確保する`selectDiverseHighlights`を通している。この上限を撤廃/緩和する変更を
行う際は、新規ランクインだけでハイライトが埋まっていないか実データで確認すること。

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

## AIインサイトの表示 (アコーディオン形式・全件展開しない)

`InsightCard.tsx`は`/api/insights`の直近5件を表示する際、ネイティブの`<details>`/
`<summary>`によるアコーディオンになっている。**最新1件のみ`open={isLatest}`で展開済み**
表示し、過去分は「日時+分析文の一行プレビュー」のみの折りたたみ行にしてクリックで個別展開する
方式にしている。理由: 実データ(分析文+予測文+ハイライトバッジ最大8件)で5件を単純に縦積み
表示すると、Playwrightでの実測でページ全体が約3900pxまで伸び、ランキング表より大幅に縦長に
なることを確認した。ここを直す/拡張する際、全件を常時展開する縦積み表示には戻さないこと。
`open`はReactの`value`/`checked`のような完全制御ではなく初期値としてのみ使われるため、
親の再レンダーでユーザーの手動トグル状態が上書きされることはない(状態をReact側で持たない
ことで、このプロジェクトの厳しい`react-hooks`ルールの対象にもならない)。

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

### グラフ凡例は独自実装 (Rechartsの`<Legend>`を使わない)

楽天の商品名は60〜100文字を超えることが珍しくない。Recharts標準の`<Legend>`にそのまま渡すと、
名前が折り返し放題になりコンテナからはみ出して下のランキング表と重なる崩れ方をする(実際にモック無しの
本番データで再現・確認済み)。そのため `RankingChart.tsx` では`<Legend>`は使わず、`ChartLegend`という
独自のチップ型コンポーネント(CSSの`truncate`で省略+`title`属性で全文をホバー表示+クリックで
選択解除)を使っている。ここを直す/拡張する際もRecharts標準Legendには戻さないこと。

### 商品名冒頭の販促文言の除去 (表示専用)

楽天の商品名は「今夜23:59までポイント10倍！お試し送料無料2,490円～」のような販促・SEO文言が
冒頭に付くことが非常に多く、truncate表示だと肝心の商品名が見えないことが実データで多数確認された。
`src/lib/format/itemName.ts`の`displayItemName()`がこれを表示専用に取り除く
(`RankingLeaderboard` / `RankingChart`の凡例・ツールチップ / `InsightCard`のハイライトバッジで使用)。
正規表現ベースの経験則で、元の`itemName`データは一切変更しない。呼び出し側は必ず`title`属性等で
元の全文を確認できるようにすること。この関数を拡張する際は、実データ(`/api/rankings`)の商品名で
`node`から直接テストし、既存の除去パターンを壊していないか確認してから反映すること
(位置ベースの経験則のため、閾値を少し変えるだけで挙動が大きく変わりやすい)。

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
