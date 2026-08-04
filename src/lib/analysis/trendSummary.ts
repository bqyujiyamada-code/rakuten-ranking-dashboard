import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/config/env";
import { formatJstDateLabel } from "@/lib/date/jst";

const MODEL = "gemini-3-flash-preview";

// gemini.tsのGEMINI_HTTP_OPTIONSと同じ理由(SDK既定の5回リトライがVercel Hobbyの300秒予算を
// 独り占めしうるため)でリトライを行わない。この呼び出しは1日1回だけなので、検索grounding分の
// 余裕を見てタイムアウトはgenerateTrendInsightより長めにしている。
const TREND_HTTP_OPTIONS = {
  timeout: 20_000,
  retryOptions: { attempts: 1 },
} as const;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.gemini.apiKey });
  }
  return client;
}

export interface DailyTrendSummary {
  summaryText: string;
  sources: { title: string; uri: string }[];
}

/**
 * Google検索groundingを使い、指定日(JST暦日)前後の日本国内の消費・購買行動に
 * 影響しそうな主要ニュース・話題をGemini自身に要約させる。
 *
 * 構造化出力(responseSchema)とgoogleSearchツールは同時に使えないため、
 * この呼び出しはプレーンテキストで受け取り、ランキング分析用の構造化JSON呼び出し
 * (gemini.ts)とは別のGemini呼び出しとして分離している。全ジャンル共通の情報のため、
 * 収集バッチ全体で1回だけ呼び出す想定 (ジャンルごとに呼ばないこと)。
 */
export async function fetchDailyTrendSummary(
  date: string,
): Promise<DailyTrendSummary> {
  const ai = getClient();
  const dateLabel = formatJstDateLabel(date);

  const prompt = `${dateLabel}(日本時間)前後に、日本国内で話題になった
ニュース・SNSでの話題・季節のイベントのうち、消費者の購買行動(通販での買い物)に
影響を与えていそうなものを、Google検索の結果に基づいて3〜5個、日本語の箇条書きで
簡潔に要約してください。

- 各項目は1行程度で、具体的な話題(何が起きたか)を書くこと。
- 個人の噂話やゴシップではなく、天候・気温・災害・大型セール/イベント・
  流行語・話題の商品ジャンルなど、消費行動と関連しそうな話題を優先すること。
- 該当する話題が見つからない場合は「特筆すべき話題は見当たらない」とだけ書くこと。
  存在しない話題を作り上げないこと。`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      httpOptions: TREND_HTTP_OPTIONS,
    },
  });

  const summaryText = response.text?.trim();
  if (!summaryText) {
    throw new Error("Gemini API returned an empty trend summary");
  }

  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: { title: string; uri: string }[] = [];
  for (const chunk of groundingChunks) {
    const uri = chunk.web?.uri;
    if (uri) {
      sources.push({ title: chunk.web?.title ?? uri, uri });
    }
  }

  return { summaryText, sources };
}
