import { GoogleGenAI, Type } from "@google/genai";
import { env } from "@/lib/config/env";
import type { DiffHighlightRecord } from "@/lib/db/types";

const MODEL = "gemini-3-flash-preview";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.gemini.apiKey });
  }
  return client;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    trendAnalysis: {
      type: Type.STRING,
      description: "直近の変動から読み取れる消費者トレンドの考察 (日本語3〜4文)",
    },
    forecast: {
      type: Type.STRING,
      description: "今後ランクインしてきそうな商品傾向の予測 (日本語3〜4文)",
    },
  },
  required: ["trendAnalysis", "forecast"],
} as const;

const JST_DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

export interface PreviousInsight {
  trendAnalysisText: string;
  forecastText?: string;
}

function buildPrompt(
  genreName: string,
  highlights: DiffHighlightRecord[],
  collectedAt: Date,
  previousInsight: PreviousInsight | null,
): string {
  const bulletList = highlights
    .map((h, i) => `${i + 1}. [${h.type}] ${h.itemName} — ${h.detail}`)
    .join("\n");
  const todayLabel = JST_DATE_FORMATTER.format(collectedAt);

  const continuitySection = previousInsight
    ? `
## 前回分析(参考・連続性のため)
前回のtrendAnalysis: ${previousInsight.trendAnalysisText}
前回のforecast: ${previousInsight.forecastText ?? "(記録なし)"}

上記は前回収集時点の分析です。今回の変動が前回の続きなのか、方向転換したのか、
特に動きがないのかを意識して書いてください。前回の文章をそのまま繰り返さず、
今回新たに分かったこと・変化した点を中心に書くこと。目立った変化がなければ
「前回からの傾向に大きな変化はない」のように正直に書いてよい。
`
    : "";

  return `あなたは楽天市場のトレンドを分析するECマーケットアナリストです。
本日の日付は${todayLabel}(日本時間)です。以下は「${genreName}」ジャンルの楽天ランキングにおける、
前回計測時からの主な変動点です。

${bulletList}
${continuitySection}
分析にあたっては、以下の点に注意してください。
- 商品名には「お中元」「セール」「今だけ」等の販促・SEO目的のキーワードが実際の時期と関係なく
  含まれていることが多い。本日の日付と照らして時期的に妥当かどうかを必ず確認し、季節性を
  安易に断定しないこと。
- 楽天のリアルタイムランキングは母数が小さいジャンルほど日々の入れ替わりが激しく、新規ランクイン
  が多いこと自体は必ずしも強いトレンドを意味しない。データから読み取れる範囲を超えて、もっともら
  しい物語を作り上げないこと。根拠が薄い場合は「明確な傾向は読み取りにくい」旨を正直に書いてよい。

次の2つを、それぞれ日本語で3〜4文程度の簡潔な文章として作成してください。断定しすぎず
「〜と考えられます」「〜の可能性があります」のような推察のトーンで書き、商品名を箇条書きで
繰り返すのではなく傾向として何が起きているかを説明してください。

1. trendAnalysis: これらの変動から読み取れる消費者トレンドや、変動の背景として考えられる理由
   (季節性、セール、メディア露出、価格戦略など)。
2. forecast: 上記のトレンドが続いた場合、今後このジャンルで新たにランクインしてきそうな
   商品の傾向(カテゴリ・価格帯・訴求ポイントなど)についての予測。個別の未発売商品名を
   でっち上げるのではなく、「〜のような商品」「〜系の商品」といった傾向として述べること。`;
}

export interface TrendInsightResult {
  trendAnalysisText: string;
  forecastText: string;
}

/**
 * 差分ハイライトをもとに、Geminiにトレンド考察(直近の変動分析)と
 * 今後ランクインしてきそうな商品傾向の予測を生成させる。
 * ハイライトが空の場合は呼び出さず、呼び出し側でスキップする想定。
 */
export async function generateTrendInsight(
  genreName: string,
  highlights: DiffHighlightRecord[],
  collectedAt: Date = new Date(),
  previousInsight: PreviousInsight | null = null,
): Promise<TrendInsightResult> {
  const ai = getClient();
  const prompt = buildPrompt(genreName, highlights, collectedAt, previousInsight);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini API returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini API returned a non-JSON response");
  }

  const { trendAnalysis, forecast } = parsed as {
    trendAnalysis?: unknown;
    forecast?: unknown;
  };

  if (typeof trendAnalysis !== "string" || typeof forecast !== "string") {
    throw new Error("Gemini API response is missing trendAnalysis/forecast fields");
  }

  return {
    trendAnalysisText: trendAnalysis.trim(),
    forecastText: forecast.trim(),
  };
}
