import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "@/lib/aws/dynamodb";
import {
  GSI1_NAME,
  META_SK,
  genreGsi1Pk,
  genreGsi1Sk,
  genreGsi1SkPrefix,
  insightPk,
  insightSk,
  itemPk,
  itemSk,
  metaPk,
} from "@/lib/db/keys";
import type {
  DiffHighlightRecord,
  GenreMetaItem,
  InsightItem,
  RankingSnapshotItem,
} from "@/lib/db/types";
import type { RankingItem } from "@/lib/rakuten/types";

const BATCH_WRITE_CHUNK_SIZE = 25;
const MAX_BATCH_WRITE_RETRIES = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** 取得したランキング結果をスナップショットとして書き込む (1ジャンル分) */
export async function putRankingSnapshot(
  genreId: string,
  timestamp: string,
  items: RankingItem[],
): Promise<void> {
  const records: RankingSnapshotItem[] = items.map((item) => ({
    PK: itemPk(genreId, item.itemCode),
    SK: itemSk(timestamp),
    entityType: "RANKING_ITEM",
    genreId,
    itemCode: item.itemCode,
    itemName: item.itemName,
    rank: item.rank,
    price: item.price,
    itemUrl: item.itemUrl,
    imageUrl: item.imageUrl,
    shopName: item.shopName,
    reviewCount: item.reviewCount,
    reviewAverage: item.reviewAverage,
    capturedAt: timestamp,
    GSI1PK: genreGsi1Pk(genreId),
    GSI1SK: genreGsi1Sk(timestamp, item.rank),
  }));

  for (const batch of chunk(records, BATCH_WRITE_CHUNK_SIZE)) {
    await writeBatchWithRetry(batch);
  }
}

async function writeBatchWithRetry(batch: RankingSnapshotItem[]): Promise<void> {
  type RequestItemsMap = Record<
    string,
    { PutRequest: { Item: RankingSnapshotItem } }[]
  >;

  let requestItems: RequestItemsMap = {
    [TABLE_NAME]: batch.map((Item) => ({ PutRequest: { Item } })),
  };

  let attempt = 0;
  while (Object.keys(requestItems).length > 0) {
    const response = await ddb.send(
      new BatchWriteCommand({ RequestItems: requestItems }),
    );

    const unprocessed = response.UnprocessedItems as RequestItemsMap | undefined;
    if (!unprocessed || Object.keys(unprocessed).length === 0) {
      return;
    }

    attempt += 1;
    if (attempt > MAX_BATCH_WRITE_RETRIES) {
      throw new Error(
        "BatchWriteCommand: exceeded retry attempts with unprocessed items remaining",
      );
    }

    requestItems = unprocessed;
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
  }
}

/** ジャンルの最新/直前収集タイムスタンプを保持するメタアイテムを取得 */
export async function getGenreMeta(genreId: string): Promise<GenreMetaItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: metaPk(genreId), SK: META_SK },
    }),
  );
  return (result.Item as GenreMetaItem | undefined) ?? null;
}

/**
 * メタアイテムを新しいタイムスタンプで更新し、更新前の latestTimestamp を返す。
 * 返り値の previousTimestamp を差分検知の「前回スナップショット」として使う。
 */
export async function advanceGenreMeta(
  genreId: string,
  newTimestamp: string,
): Promise<{ previousTimestamp: string | null }> {
  const current = await getGenreMeta(genreId);
  const previousTimestamp = current?.latestTimestamp ?? null;

  const updated: GenreMetaItem = {
    PK: metaPk(genreId),
    SK: META_SK,
    entityType: "GENRE_META",
    genreId,
    latestTimestamp: newTimestamp,
    previousTimestamp: previousTimestamp ?? undefined,
    updatedAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: updated }));

  return { previousTimestamp };
}

/** GSI1を使い、指定ジャンル・指定タイムスタンプの順位表を取得 (rank昇順) */
export async function getSnapshotAtTimestamp(
  genreId: string,
  timestamp: string,
): Promise<RankingSnapshotItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :tsPrefix)",
      ExpressionAttributeValues: {
        ":pk": genreGsi1Pk(genreId),
        ":tsPrefix": genreGsi1SkPrefix(timestamp),
      },
    }),
  );
  const items = (result.Items ?? []) as RankingSnapshotItem[];
  return items.sort((a, b) => a.rank - b.rank);
}

/** メタアイテムのlatestTimestampを使って現在の順位表を取得 */
export async function getLatestSnapshot(
  genreId: string,
): Promise<RankingSnapshotItem[]> {
  const meta = await getGenreMeta(genreId);
  if (!meta?.latestTimestamp) return [];
  return getSnapshotAtTimestamp(genreId, meta.latestTimestamp);
}

/** 特定商品の順位・価格の時系列 (グラフ描画用) */
export async function getItemTimeSeries(
  genreId: string,
  itemCode: string,
  limit = 90,
): Promise<RankingSnapshotItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": itemPk(genreId, itemCode) },
      ScanIndexForward: true,
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as RankingSnapshotItem[];
}

/** AI分析済みインサイトコメントを保存 */
export async function putInsight(
  genreId: string,
  timestamp: string,
  aiAnalysisText: string,
  forecastText: string,
  highlights: DiffHighlightRecord[],
): Promise<void> {
  const item: InsightItem = {
    PK: insightPk(genreId),
    SK: insightSk(timestamp),
    entityType: "AI_INSIGHT",
    genreId,
    timestamp,
    aiAnalysisText,
    forecastText,
    highlights,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function getLatestInsight(genreId: string): Promise<InsightItem | null> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": insightPk(genreId) },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const [item] = result.Items ?? [];
  return (item as InsightItem | undefined) ?? null;
}

export async function listInsights(
  genreId: string,
  limit = 10,
): Promise<InsightItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": insightPk(genreId) },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as InsightItem[];
}
