// ジャンル×JST暦月の月次ロールアップを計算するスクリプト。
//
// 季節性・長期トレンド分析(将来の別タスク)の土台となる集計値を、その月の生データ
// (ランキングスナップショット/差分ハイライト/気象)から都度フル再計算する。
// インクリメンタルな積み上げ方式ではなく毎回フル再計算するため、同じ月を何度実行しても
// 結果は安定する(冪等)。日次収集Cron(src/lib/collectAndAnalyze.ts)には一切
// 手を入れておらず、実行時間予算に影響しない。
//
// scripts/backfill-daily-context.mjs と同じ流儀: src/lib からはimportせず、
// 必要なキー生成ロジックをここに複製している(「同期させること」コメント参照)。
//
// 使い方:
//   node scripts/compute-monthly-rollup.mjs --month=2026-08                # 全16ジャンルdry-run
//   node scripts/compute-monthly-rollup.mjs --month=2026-08 --genre=100283 # 1ジャンルのみ
//   node scripts/compute-monthly-rollup.mjs --month=2026-08 --apply        # 実際に書き込み
//   node scripts/compute-monthly-rollup.mjs                                # --month省略 = 実行時点のJST暦月
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? "RakutenRankings";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const GSI1_NAME = "GSI1_GenreTimestamp";
const GSI2_NAME = "GSI2_DailyBundle";

const APPLY = process.argv.includes("--apply");
const MONTH_ARG = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];
const GENRE_ARG = process.argv.find((a) => a.startsWith("--genre="))?.split("=")[1];

// src/lib/rakuten/genres.ts の genreId 一覧と同期させること
const TARGET_GENRE_IDS = [
  "100228", "100236", "110472", "100293", "100256", "100300", "100262",
  "100283", "509708", "201136", "201150", "201351", "100356", "100324",
  "100317", "100337",
];

const HIGHLIGHT_TYPES = ["NEW_ENTRY", "RANK_SURGE", "RANK_DROP", "PRICE_DROP", "PRICE_UP"];
const ITEMS_PER_SNAPSHOT = 30;

// --- src/lib/analysis/rollupMetrics.ts と同期させること (対応42.) ---
const ROLLUP_MAX_NAME_KEYWORDS = 40;
const ROLLUP_MAX_TOP_ITEMS = 40;
const SEASONAL_PHRASES = [
  "お中元", "御中元", "お歳暮", "御歳暮", "母の日", "父の日", "敬老の日",
  "土用の丑", "恵方巻", "暑中見舞い", "残暑見舞い", "お花見", "年越し",
  "お正月", "お盆", "ひな祭り", "こどもの日", "ハロウィン",
];
const KEYWORD_STOPWORDS = new Set([
  "送料無料", "送料込", "ポイント", "楽天", "クーポン", "セール", "特価",
  "割引", "まとめ買い", "在庫", "予約", "数量限定", "期間限定", "ランキング",
  "あす楽", "配送", "のし", "ラッピング", "ギフ", "メッセ", "宛書",
  "kg", "ml", "cc", "mg", "mm", "cm", "oz", "lb",
]);
const TOKEN_RE = /[ァ-ヶー・]{2,}|[一-鿿々]{2,}|[A-Za-z][A-Za-z0-9]+/g;

function extractNameKeywords(name) {
  const found = new Set();
  let rest = name.replace(/楽ギフ[_＿][^\]】\s]*/g, " ");
  for (const phrase of SEASONAL_PHRASES) {
    if (rest.includes(phrase)) {
      found.add(phrase);
      rest = rest.split(phrase).join(" ");
    }
  }
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(rest)) !== null) {
    const raw = match[0];
    const term = /[A-Za-z]/.test(raw) ? raw.toLowerCase() : raw;
    if (term.length < 2) continue;
    if (KEYWORD_STOPWORDS.has(term)) continue;
    found.add(term);
  }
  return [...found];
}

function summariseMonthlySnapshots(dailySnapshots) {
  const keywordItemCodes = new Map();
  const keywordOccurrences = new Map();
  const items = new Map();

  for (const day of dailySnapshots) {
    for (const row of day) {
      if (!row.itemCode) continue;
      const rank = Number(row.rank);
      const existing = items.get(row.itemCode);
      if (existing) {
        existing.daysPresent += 1;
        existing.rankSum += rank;
        existing.bestRank = Math.min(existing.bestRank, rank);
        if (row.itemName) existing.itemName = row.itemName;
      } else {
        items.set(row.itemCode, {
          itemName: row.itemName,
          daysPresent: 1,
          rankSum: rank,
          bestRank: rank,
        });
      }
      for (const term of extractNameKeywords(row.itemName)) {
        keywordOccurrences.set(term, (keywordOccurrences.get(term) ?? 0) + 1);
        let codes = keywordItemCodes.get(term);
        if (!codes) {
          codes = new Set();
          keywordItemCodes.set(term, codes);
        }
        codes.add(row.itemCode);
      }
    }
  }

  const nameKeywords = [...keywordOccurrences.entries()]
    .map(([term, occurrences]) => ({
      term,
      occurrences,
      itemCount: keywordItemCodes.get(term)?.size ?? 0,
    }))
    .sort(
      (a, b) =>
        b.itemCount - a.itemCount ||
        b.occurrences - a.occurrences ||
        a.term.localeCompare(b.term),
    )
    .slice(0, ROLLUP_MAX_NAME_KEYWORDS);

  const topItems = [...items.entries()]
    .map(([itemCode, v]) => ({
      itemCode,
      itemName: v.itemName,
      daysPresent: v.daysPresent,
      avgRank: Math.round((v.rankSum / v.daysPresent) * 10) / 10,
      bestRank: v.bestRank,
    }))
    .sort(
      (a, b) =>
        b.daysPresent - a.daysPresent ||
        a.avgRank - b.avgRank ||
        a.itemCode.localeCompare(b.itemCode),
    )
    .slice(0, ROLLUP_MAX_TOP_ITEMS);

  return { nameKeywords, topItems };
}
// --- ここまで (src/lib/analysis/rollupMetrics.ts と同期) ---

// src/lib/date/jst.ts と同じロジック
const JST_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});
function toJstDateString(date) {
  return JST_DATE_KEY_FORMATTER.format(date);
}
function addDaysJst(dateStr, deltaDays) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  noonUtc.setUTCDate(noonUtc.getUTCDate() + deltaDays);
  return toJstDateString(noonUtc);
}
function currentJstMonth() {
  return toJstDateString(new Date()).slice(0, 7); // "YYYY-MM"
}

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// --- src/lib/db/keys.ts と同期させること ---
const genreGsi1Pk = (genreId) => `GENRE#${genreId}`;
const genreGsi1SkPrefix = (timestamp) => `TS#${timestamp}#`;
const highlightsPk = (genreId) => `GENRE#${genreId}#HIGHLIGHTS`;
const highlightsSk = (timestamp) => `TS#${timestamp}`;
const insightPk = (genreId) => `GENRE#${genreId}#INSIGHT`;
const insightSk = (timestamp) => `TS#${timestamp}`;
const weatherPk = (date) => `WEATHER#${date}`;
const monthlyRollupPk = (genreId) => `GENRE#${genreId}#ROLLUP`;
const monthlyRollupSk = (month) => `MONTH#${month}`;
// --- ここまで ---

/** 指定月(YYYY-MM)に実際に収集できた日付一覧を、GSI2_DailyBundleから取得 */
async function listDailyBundlesForMonth(month) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI2_NAME,
      KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :month)",
      ExpressionAttributeValues: { ":pk": "DAILY_BUNDLE", ":month": month },
    }),
  );
  return (result.Items ?? []).sort((a, b) => a.date.localeCompare(b.date));
}

async function getSnapshotAtTimestamp(genreId, timestamp) {
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
  return result.Items ?? [];
}

async function getHighlightsAtTimestamp(genreId, timestamp) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: highlightsPk(genreId), SK: highlightsSk(timestamp) },
    }),
  );
  return result.Item ?? null;
}

/**
 * 2026-08-06のDiffHighlightsItem分離より前に書き込まれた日はInsightItem側に
 * highlightsが埋め込まれたままなので、そちらにフォールバックする
 * (src/app/api/insights/route.tsの後方互換ロジックと同じ)。
 */
async function getHighlightsWithFallback(genreId, timestamp) {
  const highlightsItem = await getHighlightsAtTimestamp(genreId, timestamp);
  if (highlightsItem?.highlights) return highlightsItem.highlights;

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: insightPk(genreId), SK: insightSk(timestamp) },
    }),
  );
  return result.Item?.highlights ?? [];
}

async function getWeatherDaily(date) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: weatherPk(date), SK: "DAILY" },
    }),
  );
  return result.Item ?? null;
}

async function putMonthlyRollup(item) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: monthlyRollupPk(item.genreId),
        SK: monthlyRollupSk(item.month),
        entityType: "MONTHLY_ROLLUP",
        ...item,
        computedAt: new Date().toISOString(),
      },
    }),
  );
}

/** 1ジャンル・1ヶ月分のロールアップを計算する */
async function computeRollupForGenre(genreId, month, dailyBundles) {
  const prices = [];
  const itemCodes = new Set();
  const dailySnapshots = [];
  const highlightCounts = Object.fromEntries(HIGHLIGHT_TYPES.map((t) => [t, 0]));
  const weatherSamples = [];

  for (const bundle of dailyBundles) {
    const [snapshot, highlights, weather] = await Promise.all([
      getSnapshotAtTimestamp(genreId, bundle.timestamp),
      getHighlightsWithFallback(genreId, bundle.timestamp),
      getWeatherDaily(addDaysJst(bundle.date, -1)),
    ]);

    dailySnapshots.push(
      snapshot.map((item) => ({
        rank: Number(item.rank),
        itemCode: item.itemCode,
        itemName: item.itemName,
      })),
    );
    for (const item of snapshot) {
      if (typeof item.price === "number") prices.push(item.price);
      if (item.itemCode) itemCodes.add(item.itemCode);
    }

    for (const highlight of highlights) {
      if (highlight.type in highlightCounts) highlightCounts[highlight.type] += 1;
    }

    if (weather) {
      weatherSamples.push({
        tempMaxC: weather.tempMaxC,
        tempMinC: weather.tempMinC,
        precipitationMm: weather.precipitationMm,
      });
    }
  }

  const daysCollected = dailyBundles.length;
  const priceStats = prices.length
    ? {
        avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 10) / 10,
        min: Math.min(...prices),
        max: Math.max(...prices),
      }
    : { avg: 0, min: 0, max: 0 };

  const weather = weatherSamples.length
    ? {
        avgTempMaxC:
          Math.round(
            (weatherSamples.reduce((a, w) => a + w.tempMaxC, 0) / weatherSamples.length) * 10,
          ) / 10,
        avgTempMinC:
          Math.round(
            (weatherSamples.reduce((a, w) => a + w.tempMinC, 0) / weatherSamples.length) * 10,
          ) / 10,
        totalPrecipitationMm:
          Math.round(weatherSamples.reduce((a, w) => a + w.precipitationMm, 0) * 10) / 10,
        daysWithData: weatherSamples.length,
      }
    : null;

  const { nameKeywords, topItems } = summariseMonthlySnapshots(dailySnapshots);

  return {
    genreId,
    month,
    daysCollected,
    priceStats,
    uniqueItemCount: itemCodes.size,
    totalItemSlots: daysCollected * ITEMS_PER_SNAPSHOT,
    highlightCounts,
    nameKeywords,
    topItems,
    weather,
  };
}

function printRollup(rollup) {
  const h = rollup.highlightCounts;
  console.log(`  ジャンル ${rollup.genreId} (${rollup.month})`);
  console.log(
    `    収集日数: ${rollup.daysCollected}日 / ユニーク商品数: ${rollup.uniqueItemCount} ` +
      `(全${rollup.totalItemSlots}枠中)`,
  );
  console.log(
    `    価格: 平均¥${rollup.priceStats.avg} / 最安¥${rollup.priceStats.min} / ` +
      `最高¥${rollup.priceStats.max}`,
  );
  console.log(
    `    ハイライト: 新規${h.NEW_ENTRY} / 急上昇${h.RANK_SURGE} / 急下降${h.RANK_DROP} / ` +
      `値下げ${h.PRICE_DROP} / 値上げ${h.PRICE_UP}`,
  );
  const kw = rollup.nameKeywords
    .slice(0, 8)
    .map((k) => `${k.term}(${k.itemCount})`)
    .join(" / ");
  console.log(`    キーワード上位: ${kw || "(なし)"}`);
  const top = rollup.topItems
    .slice(0, 3)
    .map((t) => `${t.itemName.slice(0, 16)}…(${t.daysPresent}日/avg${t.avgRank})`)
    .join(" / ");
  console.log(`    在籍上位: ${top || "(なし)"}`);
  if (rollup.weather) {
    console.log(
      `    気象: 平均最高${rollup.weather.avgTempMaxC}°C / 平均最低${rollup.weather.avgTempMinC}°C / ` +
        `降水量合計${rollup.weather.totalPrecipitationMm}mm (${rollup.weather.daysWithData}日分)`,
    );
  } else {
    console.log("    気象: データなし");
  }
}

async function main() {
  const month = MONTH_ARG ?? currentJstMonth();
  const genreIds = GENRE_ARG ? [GENRE_ARG] : TARGET_GENRE_IDS;

  console.log(`対象月: ${month}`);
  console.log(`対象ジャンル: ${genreIds.length}件`);
  console.log(`Mode: ${APPLY ? "APPLY (書き込みます)" : "DRY-RUN (書き込みません。--apply で実行)"}`);
  console.log("");

  const dailyBundles = await listDailyBundlesForMonth(month);
  console.log(`${month}の収集日: ${dailyBundles.map((b) => b.date).join(", ") || "(なし)"}`);
  console.log("");

  if (dailyBundles.length === 0) {
    console.log("この月の収集データがまだ無いため、ロールアップ対象がありません。終了します。");
    return;
  }

  for (const genreId of genreIds) {
    const rollup = await computeRollupForGenre(genreId, month, dailyBundles);
    printRollup(rollup);
    if (APPLY) {
      await putMonthlyRollup(rollup);
      console.log("    -> 保存しました");
    }
    console.log("");
  }

  console.log(APPLY ? "完了しました。" : "dry-runが完了しました。--apply を付けて再実行すると書き込まれます。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
