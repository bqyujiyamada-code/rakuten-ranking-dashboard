import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "@/lib/aws/dynamodb";
import {
  DAILY_BUNDLE_GSI2PK,
  DAILY_BUNDLE_SK,
  GSI1_NAME,
  GSI2_NAME,
  META_SK,
  TREND_SK,
  WEATHER_SK,
  dailyBundleGsi2Sk,
  dailyBundlePk,
  genreGsi1Pk,
  genreGsi1Sk,
  genreGsi1SkPrefix,
  highlightsPk,
  highlightsSk,
  insightPk,
  insightSk,
  itemPk,
  itemSk,
  metaPk,
  monthlyRollupPk,
  monthlyRollupSk,
  trendPk,
  weatherPk,
} from "@/lib/db/keys";
import type {
  DailyBundleItem,
  DiffHighlightRecord,
  DiffHighlightsItem,
  GenreMetaItem,
  InsightItem,
  MonthlyRollupItem,
  RankingSnapshotItem,
  TrendDailyItem,
  WeatherDailyItem,
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

/** AI分析済みインサイトコメントを保存(ハイライトはputHighlightsで別途保存する) */
export async function putInsight(
  genreId: string,
  timestamp: string,
  aiAnalysisText: string,
  forecastText: string,
): Promise<void> {
  const item: InsightItem = {
    PK: insightPk(genreId),
    SK: insightSk(timestamp),
    entityType: "AI_INSIGHT",
    genreId,
    timestamp,
    aiAnalysisText,
    forecastText,
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

/**
 * 差分ハイライトを保存。Gemini分析の成否とは独立に、差分検知ができた収集バッチで必ず
 * 呼ぶこと(collectAndAnalyze.ts参照)。
 */
export async function putHighlights(
  genreId: string,
  timestamp: string,
  highlights: DiffHighlightRecord[],
): Promise<void> {
  const item: DiffHighlightsItem = {
    PK: highlightsPk(genreId),
    SK: highlightsSk(timestamp),
    entityType: "DIFF_HIGHLIGHTS",
    genreId,
    timestamp,
    highlights,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function getHighlightsAtTimestamp(
  genreId: string,
  timestamp: string,
): Promise<DiffHighlightsItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: highlightsPk(genreId), SK: highlightsSk(timestamp) },
    }),
  );
  return (result.Item as DiffHighlightsItem | undefined) ?? null;
}

/** 特定timestampのインサイトをピンポイントで取得 (過去日付のバックナンバー閲覧用) */
export async function getInsightAtTimestamp(
  genreId: string,
  timestamp: string,
): Promise<InsightItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: insightPk(genreId), SK: insightSk(timestamp) },
    }),
  );
  return (result.Item as InsightItem | undefined) ?? null;
}

/** 気象データ(日次・東京)を保存。dateはその気象が実際に発生したJST暦日 */
export async function putWeatherDaily(
  date: string,
  data: Omit<WeatherDailyItem, "PK" | "SK" | "entityType" | "date">,
): Promise<void> {
  const item: WeatherDailyItem = {
    PK: weatherPk(date),
    SK: WEATHER_SK,
    entityType: "WEATHER_DAILY",
    date,
    ...data,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function getWeatherDaily(date: string): Promise<WeatherDailyItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: weatherPk(date), SK: WEATHER_SK },
    }),
  );
  return (result.Item as WeatherDailyItem | undefined) ?? null;
}

/** 世間のトレンド要約(日次)を保存。dateは要約の対象としたJST暦日 */
export async function putTrendDaily(
  date: string,
  summaryText: string,
  sources: { title: string; uri: string }[],
): Promise<void> {
  const item: TrendDailyItem = {
    PK: trendPk(date),
    SK: TREND_SK,
    entityType: "TREND_DAILY",
    date,
    summaryText,
    sources,
    fetchedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function getTrendDaily(date: string): Promise<TrendDailyItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: trendPk(date), SK: TREND_SK },
    }),
  );
  return (result.Item as TrendDailyItem | undefined) ?? null;
}

/** 日次バンドル索引を保存 (収集バッチの最後に1回呼ぶ) */
export async function putDailyBundle(
  date: string,
  timestamp: string,
  causalDate: string,
): Promise<void> {
  const item: DailyBundleItem = {
    PK: dailyBundlePk(date),
    SK: DAILY_BUNDLE_SK,
    entityType: "DAILY_BUNDLE",
    date,
    timestamp,
    causalDate,
    GSI2PK: DAILY_BUNDLE_GSI2PK,
    GSI2SK: dailyBundleGsi2Sk(date),
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function getDailyBundle(date: string): Promise<DailyBundleItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: dailyBundlePk(date), SK: DAILY_BUNDLE_SK },
    }),
  );
  return (result.Item as DailyBundleItem | undefined) ?? null;
}

/** 利用可能な過去の収集日を新しい順に一覧取得 (日付ピッカー用) */
export async function listRecentDailyBundles(limit = 90): Promise<DailyBundleItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI2_NAME,
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": DAILY_BUNDLE_GSI2PK },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as DailyBundleItem[];
}

/** 指定月(YYYY-MM)に実際に収集できた日付一覧をGSI2_DailyBundleから取得(日付昇順) */
export async function listDailyBundlesForMonth(
  month: string,
): Promise<DailyBundleItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI2_NAME,
      KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :month)",
      ExpressionAttributeValues: { ":pk": DAILY_BUNDLE_GSI2PK, ":month": month },
    }),
  );
  const items = (result.Items ?? []) as DailyBundleItem[];
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 月次ロールアップを保存。生データから都度フル再計算した結果を渡す想定のため、
 * 常に上書き(冪等)。scripts/compute-monthly-rollup.mjsおよびsrc/lib/analysis/monthlyRollup.ts
 * (対応36.、/api/cron/monthly-rollupによる自動計算)から呼ばれる。
 */
export async function putMonthlyRollup(
  data: Omit<MonthlyRollupItem, "PK" | "SK" | "entityType" | "computedAt">,
): Promise<void> {
  const item: MonthlyRollupItem = {
    PK: monthlyRollupPk(data.genreId),
    SK: monthlyRollupSk(data.month),
    entityType: "MONTHLY_ROLLUP",
    ...data,
    computedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function getMonthlyRollup(
  genreId: string,
  month: string,
): Promise<MonthlyRollupItem | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: monthlyRollupPk(genreId), SK: monthlyRollupSk(month) },
    }),
  );
  return (result.Item as MonthlyRollupItem | undefined) ?? null;
}

/** 指定ジャンルの月次ロールアップを古い順(月の昇順)に一覧取得 */
export async function listMonthlyRollups(
  genreId: string,
  limit = 24,
): Promise<MonthlyRollupItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": monthlyRollupPk(genreId) },
      ScanIndexForward: true,
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as MonthlyRollupItem[];
}
