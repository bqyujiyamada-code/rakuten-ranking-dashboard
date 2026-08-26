import { GoogleGenAI, Type } from "@google/genai";
import { env } from "@/lib/config/env";
import { formatJstDateLabel, toJstDateString } from "@/lib/date/jst";
import type { DiffHighlightRecord } from "@/lib/db/types";

const MODEL = "gemini-3-flash-preview";

// 2026-08-05〜07の3日連続障害を受け、この呼び出しは`collectAndAnalyze.ts`で
// GEMINI_ANALYSIS_CONCURRENCY(8)件ずつ並行実行される設計に変更した(直列16回だと、
// 短いタイムアウトのfail-fastを積み上げるだけで300秒予算の大半を消費し、個々の呼び出しに
// 十分な時間を与えられなかったため。詳細はCLAUDE.md参照)。並行化により生まれた余裕を
// timeout延長(12秒→30秒、実測でGeminiの応答が25秒程度かかることがあるため)と
// 1回のみのリトライ(attempts: 2)に充てている。SDK既定のリトライ回数(5回・指数
// バックオフ)のまま残すのは2026-08-05に実際に予算を溶かした原因そのものなので、
// 上限は明示的に2に固定すること。16ジャンルを並行度8で処理すると最大2バッチになるため、
// 最悪ケースでも 2バッチ × (30秒 × 2回分のリトライ+バックオフ) 程度に収まり、
// 楽天API呼び出し(フェーズ1、概算70秒)と合わせても300秒予算内に収まる計算。
const GEMINI_HTTP_OPTIONS = {
  timeout: 30_000,
  retryOptions: { attempts: 2 },
} as const;

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

export interface PreviousInsight {
  trendAnalysisText: string;
  forecastText?: string;
}

/** 気象データ(因果関係分析の参考材料)。dateはこの気象が実際に発生したJST暦日 */
export interface WeatherContext {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  weatherLabel: string;
}

/** 世間のトレンド要約(因果関係分析の参考材料)。dateは要約の対象としたJST暦日 */
export interface TrendContext {
  date: string;
  summaryText: string;
}

function buildPrompt(
  genreName: string,
  highlights: DiffHighlightRecord[],
  collectedAt: Date,
  previousInsight: PreviousInsight | null,
  weather: WeatherContext | null,
  trend: TrendContext | null,
): string {
  const bulletList = highlights
    .map((h, i) => `${i + 1}. [${h.type}] ${h.itemName} — ${h.detail}`)
    .join("\n");
  const todayLabel = formatJstDateLabel(toJstDateString(collectedAt));

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

  // 今回のランキングは「前日(causalDate)の消費行動が反映された結果」として捉え、
  // 気象・トレンドは前日分を渡す (詳細な設計理由はCLAUDE.md参照)。
  const causalContextSection =
    weather || trend
      ? `
## ${formatJstDateLabel(weather?.date ?? trend?.date ?? "")}(前日)の気象・世間の動き(参考)
このランキングは、前日の気象や世間の動きが消費行動に影響し、その結果として
現れたものである可能性があります。関連が読み取れる場合の参考情報として提示します。
${weather ? `- 東京の気象: 最高${weather.tempMaxC}°C / 最低${weather.tempMinC}°C、降水量${weather.precipitationMm}mm、天気: ${weather.weatherLabel}` : ""}
${trend ? `- 世間のトレンド: ${trend.summaryText}` : ""}
`
      : "";

  return `あなたは楽天市場のトレンドを分析するECマーケットアナリストです。
本日の日付は${todayLabel}(日本時間)です。以下は「${genreName}」ジャンルの楽天ランキングにおける、
前回計測時からの主な変動点です。

${bulletList}
${continuitySection}${causalContextSection}
分析にあたっては、以下の点に注意してください。
- 商品名には「お中元」「セール」「今だけ」等の販促・SEO目的のキーワードが実際の時期と関係なく
  含まれていることが多い。本日の日付と照らして時期的に妥当かどうかを必ず確認し、季節性を
  安易に断定しないこと。
- 楽天のリアルタイムランキングは母数が小さいジャンルほど日々の入れ替わりが激しく、新規ランクイン
  が多いこと自体は必ずしも強いトレンドを意味しない。データから読み取れる範囲を超えて、もっともら
  しい物語を作り上げないこと。根拠が薄い場合は「明確な傾向は読み取りにくい」旨を正直に書いてよい。
- 気象・世間のトレンド情報が提示されている場合、ランキング変動との間に**データから合理的に
  説明できる関連**があれば、trendAnalysis内でその因果関係(例: 気温上昇→冷感・水分補給関連商品の
  需要増、大型セール→特定カテゴリの露出増)に具体的に触れること。関連が薄い、あるいはこじつけに
  なる場合は無理に天候・トレンド要因に結びつけず、気象・トレンドには触れなくてよい。存在しない
  因果関係を作り上げないこと。

次の2つを、それぞれ日本語で3〜4文程度の簡潔な文章として作成してください。断定しすぎず
「〜と考えられます」「〜の可能性があります」のような推察のトーンで書き、商品名を箇条書きで
繰り返すのではなく傾向として何が起きているかを説明してください。

1. trendAnalysis: これらの変動から読み取れる消費者トレンドや、変動の背景として考えられる理由
   (季節性、セール、メディア露出、価格戦略、気象・世間のトレンドとの関連など)。
2. forecast: 上記のトレンド(気象・世間のトレンドの傾向が今後数日続くと仮定した場合を含む)が
   続いた場合、今後このジャンルで新たにランクインしてきそうな商品の傾向(カテゴリ・価格帯・
   訴求ポイントなど)についての予測。個別の未発売商品名をでっち上げるのではなく、
   「〜のような商品」「〜系の商品」といった傾向として述べること。

【思考手順(頭の中で行い、出力には含めないこと)】
1. まず上記の内容でtrendAnalysis/forecastの草案を組み立てる。
2. 次に、懐疑的な編集者の視点に立ち、その草案に対して以下を自問し弱点を洗い出す。
   - データから読み取れる範囲を超えた推論をしていないか
   - 因果関係(気象・トレンドとの関連を含む)を過度に断定していないか
   - 単なる母数の少なさによる入れ替わりを、強いトレンドであるかのように語っていないか
   - もっと説得力のある反論や別解釈はないか
3. 洗い出した弱点があれば、トーンを弱める・言及を削る・別解釈も踏まえるなどして最終稿に
   磨き上げる。弱点が見当たらなければ草案をそのまま最終稿としてよい。
出力は上記の思考の結果得られた最終稿のtrendAnalysis/forecastのみとし、思考過程自体は
出力しないこと。`;
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
  weather: WeatherContext | null = null,
  trend: TrendContext | null = null,
): Promise<TrendInsightResult> {
  const ai = getClient();
  const prompt = buildPrompt(
    genreName,
    highlights,
    collectedAt,
    previousInsight,
    weather,
    trend,
  );

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      httpOptions: GEMINI_HTTP_OPTIONS,
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
