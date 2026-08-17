// 一回限りのバックフィルスクリプト。
// 対応16.で `client.ts` に `Number(Item.itemPrice)` 変換を入れる前(2026-07-29の最初の2回の
// 収集分のみ)にDBへ書き込まれた価格が文字列型のまま残っている問題を修正する。
// 対象は以下の2エンティティ:
//   - RankingSnapshotItem.price (GENRE#{genreId}#ITEM#{itemCode} / TS#{timestamp})
//   - InsightItem.highlights[].currentPrice/previousPrice
//     (この対象日は対応27.のDiffHighlightsItem分離より前のため、旧形式のInsightItem.highlights
//     に埋め込まれたまま残っている。DiffHighlightsItemは存在しない)
//
// 使い方:
//   node scripts/backfill-price-types.mjs            # dry-run (書き込みなし、内容を表示するだけ)
//   node scripts/backfill-price-types.mjs --apply     # 実際にDynamoDBへ書き込む
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "RakutenRankings";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const GSI1_NAME = "GSI1_GenreTimestamp";
const APPLY = process.argv.includes("--apply");

// src/lib/rakuten/genres.ts の genreId 一覧と同期させること
const TARGET_GENRE_IDS = [
  "100228", "100236", "110472", "100293", "100256", "100300", "100262",
  "100283", "509708", "201136", "201150", "201351", "100356", "100324",
  "100317", "100337",
];

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function backfillSnapshotPrices() {
  let fixed = 0;
  let checked = 0;
  for (const genreId of TARGET_GENRE_IDS) {
    let ExclusiveStartKey;
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: { ":pk": `GENRE#${genreId}` },
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) {
        checked++;
        if (typeof item.price !== "string") continue;
        const numericPrice = Number(item.price);
        console.log(
          `[${APPLY ? "apply" : "dry-run"}] ${item.PK} / ${item.SK}: price "${item.price}" -> ${numericPrice}`,
        );
        if (APPLY) {
          // IAMポリシーがUpdateItemを許可していないため、GSI1(ProjectionType: ALL)経由で
          // 取得した全属性入りのitemをそのままPutItemで書き戻す(部分更新ではなく全体上書き)
          await ddb.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: { ...item, price: numericPrice },
            }),
          );
        }
        fixed++;
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }
  console.log(`RankingSnapshotItem: ${checked}件確認, ${fixed}件が文字列型でした`);
  return fixed;
}

async function backfillInsightHighlightPrices() {
  let fixed = 0;
  let checked = 0;
  for (const genreId of TARGET_GENRE_IDS) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `GENRE#${genreId}#INSIGHT` },
      }),
    );
    for (const item of res.Items ?? []) {
      checked++;
      if (!Array.isArray(item.highlights)) continue;
      let changed = false;
      const nextHighlights = item.highlights.map((h) => {
        const next = { ...h };
        if (typeof next.currentPrice === "string") {
          next.currentPrice = Number(next.currentPrice);
          changed = true;
        }
        if (typeof next.previousPrice === "string") {
          next.previousPrice = Number(next.previousPrice);
          changed = true;
        }
        return next;
      });
      if (!changed) continue;
      console.log(
        `[${APPLY ? "apply" : "dry-run"}] ${item.PK} / ${item.SK}: highlights内の価格 ${item.highlights.length}件中を数値化`,
      );
      if (APPLY) {
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: { ...item, highlights: nextHighlights },
          }),
        );
      }
      fixed++;
    }
  }
  console.log(`InsightItem.highlights: ${checked}件確認, ${fixed}件に文字列型の価格がありました`);
  return fixed;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (書き込みます)" : "DRY-RUN (書き込みません。--apply で実行)"}`);
  console.log("");

  const snapshotFixed = await backfillSnapshotPrices();
  console.log("");
  const highlightFixed = await backfillInsightHighlightPrices();
  console.log("");

  console.log(
    APPLY
      ? `完了しました。RankingSnapshotItem ${snapshotFixed}件・InsightItem ${highlightFixed}件を数値型に変換しました。`
      : "dry-runが完了しました。内容を確認の上、--apply を付けて再実行すると書き込まれます。",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
