// 一回限りのバックフィルスクリプト。
// 対応22.(気象・トレンド統合)を導入する前に収集済みだった過去の収集日について、
// DAY#{date}索引(日付ピッカーの起点)と、東京の気象データを事後的に復元する。
//
// 世間のトレンド(Gemini Google Search grounding)は対象外: Geminiの検索groundingは
// 「今の検索結果」しか見られないため、過去日について聞いても当時のリアルタイムな
// トレンドを再現できず、後知恵の要約になってしまう。データから読み取れる範囲を
// 超えた物語を作らない、という既存の方針(CLAUDE.md参照)に反するため、
// 過去分のTRENDは空のままにする(UIはtrend=nullを許容し、判断材料パネルの
// トレンド部分だけ単に非表示になる)。
//
// 使い方:
//   node scripts/backfill-daily-context.mjs            # dry-run (書き込みなし、内容を表示するだけ)
//   node scripts/backfill-daily-context.mjs --apply     # 実際にDynamoDBへ書き込む
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
const APPLY = process.argv.includes("--apply");

// src/lib/rakuten/genres.ts の genreId 一覧と同期させること
const TARGET_GENRE_IDS = [
  "100228", "100236", "110472", "100293", "100256", "100300", "100262",
  "100283", "509708", "201136", "201150", "201351", "100356", "100324",
  "100317", "100337",
];

const TOKYO_LATITUDE = 35.6762;
const TOKYO_LONGITUDE = 139.6503;

// src/lib/weather/weatherCode.ts と同期させること
const WEATHER_CODE_LABELS = {
  0: "快晴", 1: "晴れ", 2: "一部曇り", 3: "曇り", 45: "霧", 48: "霧氷を伴う霧",
  51: "弱い霧雨", 53: "霧雨", 55: "強い霧雨", 56: "弱い着氷性の霧雨", 57: "着氷性の霧雨",
  61: "弱い雨", 63: "雨", 65: "強い雨", 66: "弱い着氷性の雨", 67: "着氷性の雨",
  71: "弱い雪", 73: "雪", 75: "強い雪", 77: "霧雪", 80: "弱いにわか雨", 81: "にわか雨",
  82: "激しいにわか雨", 85: "弱いにわか雪", 86: "にわか雪", 95: "雷雨",
  96: "弱い雹を伴う雷雨", 99: "強い雹を伴う雷雨",
};
function weatherCodeToLabel(code) {
  return WEATHER_CODE_LABELS[code] ?? `不明(コード${code})`;
}

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
function daysAgoJst(dateStr) {
  const todayStr = toJstDateString(new Date());
  const [y1, m1, d1] = todayStr.split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  const today = Date.UTC(y1, m1 - 1, d1);
  const target = Date.UTC(y2, m2 - 1, d2);
  return Math.round((today - target) / 86400000);
}

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/** 全ジャンルのGSI1を走査し、実際に収集が行われた収集バッチのtimestampを重複無く集める */
async function collectDistinctTimestamps() {
  const timestamps = new Set();
  for (const genreId of TARGET_GENRE_IDS) {
    let ExclusiveStartKey;
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: GSI1_NAME,
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: { ":pk": `GENRE#${genreId}` },
          ProjectionExpression: "GSI1SK",
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) {
        const match = /^TS#(.+)#RANK#\d+$/.exec(item.GSI1SK ?? "");
        if (match) timestamps.add(match[1]);
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }
  return [...timestamps].sort();
}

async function getDailyBundle(date) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `DAY#${date}`, SK: "META" } }),
  );
  return result.Item ?? null;
}

async function putDailyBundle(date, timestamp, causalDate) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `DAY#${date}`,
        SK: "META",
        entityType: "DAILY_BUNDLE",
        date,
        timestamp,
        causalDate,
        GSI2PK: "DAILY_BUNDLE",
        GSI2SK: date,
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

async function getWeatherDaily(date) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `WEATHER#${date}`, SK: "DAILY" } }),
  );
  return result.Item ?? null;
}

async function putWeatherDaily(date, data) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `WEATHER#${date}`,
        SK: "DAILY",
        entityType: "WEATHER_DAILY",
        date,
        location: "Tokyo",
        ...data,
        fetchedAt: new Date().toISOString(),
      },
    }),
  );
}

/** 指定した past_days 分の東京の日次気象データを1回のAPI呼び出しでまとめて取得する */
async function fetchTokyoDailyWeatherRange(pastDays) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(TOKYO_LATITUDE));
  url.searchParams.set("longitude", String(TOKYO_LONGITUDE));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
  );
  url.searchParams.set("timezone", "Asia/Tokyo");
  url.searchParams.set("past_days", String(pastDays));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText} ${body}`);
  }
  const data = await res.json();
  const daily = data.daily;
  if (!daily) return new Map();

  const weatherCodes = daily.weather_code ?? daily.weathercode ?? [];
  const map = new Map();
  daily.time.forEach((date, index) => {
    const tempMaxC = daily.temperature_2m_max?.[index];
    const tempMinC = daily.temperature_2m_min?.[index];
    const precipitationMm = daily.precipitation_sum?.[index];
    const weatherCode = weatherCodes[index];
    if (
      tempMaxC === undefined ||
      tempMinC === undefined ||
      precipitationMm === undefined ||
      weatherCode === undefined
    ) {
      return;
    }
    map.set(date, {
      tempMaxC,
      tempMinC,
      precipitationMm,
      weatherCode,
      weatherLabel: weatherCodeToLabel(weatherCode),
    });
  });
  return map;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (書き込みます)" : "DRY-RUN (書き込みません。--apply で実行)"}`);
  console.log("");

  console.log("収集済みの全ジャンルのGSI1を走査し、収集バッチのtimestampを集めています...");
  const timestamps = await collectDistinctTimestamps();
  console.log(`-> ${timestamps.length}件の異なるtimestampを検出`);

  // 同一JST暦日に複数timestampがある場合は、その日最も早いものを代表として採用する
  const byDate = new Map();
  for (const ts of timestamps) {
    const date = toJstDateString(new Date(ts));
    const existing = byDate.get(date);
    if (!existing || ts < existing) byDate.set(date, ts);
  }
  const dates = [...byDate.keys()].sort();
  console.log(`収集日(JST): ${dates.join(", ")}`);
  console.log("");

  if (dates.length === 0) {
    console.log("バックフィル対象がありません。終了します。");
    return;
  }

  const causalDates = dates.map((d) => addDaysJst(d, -1));
  const maxDaysAgo = Math.max(...causalDates.map(daysAgoJst));
  const pastDays = Math.min(92, Math.max(3, maxDaysAgo + 2));
  console.log(`Open-Meteoから過去${pastDays}日分の東京の気象データをまとめて取得します...`);
  const weatherByDate = await fetchTokyoDailyWeatherRange(pastDays);
  console.log(`-> ${weatherByDate.size}日分の気象データを取得`);
  console.log("");

  for (const date of dates) {
    const timestamp = byDate.get(date);
    const causalDate = addDaysJst(date, -1);

    const existingBundle = await getDailyBundle(date);
    if (existingBundle) {
      console.log(`[skip] DAY#${date} は既に存在します (timestamp=${existingBundle.timestamp})`);
    } else {
      console.log(
        `[${APPLY ? "apply" : "dry-run"}] DAY#${date} -> timestamp=${timestamp}, causalDate=${causalDate}`,
      );
      if (APPLY) await putDailyBundle(date, timestamp, causalDate);
    }

    const existingWeather = await getWeatherDaily(causalDate);
    if (existingWeather) {
      console.log(`[skip] WEATHER#${causalDate} は既に存在します`);
      continue;
    }
    const weather = weatherByDate.get(causalDate);
    if (!weather) {
      console.log(`[warn] WEATHER#${causalDate} のデータがOpen-Meteoから取得できませんでした`);
      continue;
    }
    console.log(
      `[${APPLY ? "apply" : "dry-run"}] WEATHER#${causalDate} -> 最高${weather.tempMaxC}°C / ` +
        `最低${weather.tempMinC}°C, 降水量${weather.precipitationMm}mm, ${weather.weatherLabel}`,
    );
    if (APPLY) await putWeatherDaily(causalDate, weather);
  }

  console.log("");
  console.log(
    APPLY
      ? "完了しました。トレンド(TREND#)は対象外のため、過去分の判断材料パネルは気象情報のみ表示されます。"
      : "dry-runが完了しました。内容を確認の上、--apply を付けて再実行すると書き込まれます。",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
