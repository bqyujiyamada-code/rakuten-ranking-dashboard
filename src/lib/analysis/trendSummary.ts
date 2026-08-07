import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/config/env";
import { formatJstDateLabel } from "@/lib/date/jst";
import { stripMarkdown } from "@/lib/format/markdown";

const MODEL = "gemini-3-flash-preview";

// この呼び出しは`collectAndAnalyze.ts`でフェーズ1(楽天APIのランキング収集、レート制限に
// より直列・概算70秒)と並行して開始されるため、フェーズ1の待ち時間にほぼ相乗りできる
// (詳細はCLAUDE.md参照)。1日1回だけの呼び出しであることも踏まえ、gemini.tsの
// GEMINI_HTTP_OPTIONSと同じ理由(SDK既定の5回リトライで予算を溶かさないため)で上限を
// 明示的に2に固定した上で、検索grounding分の余裕を見てタイムアウトも伸ばしている。
const TREND_HTTP_OPTIONS = {
  timeout: 35_000,
  retryOptions: { attempts: 2 },
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
  存在しない話題を作り上げないこと。
- 出力はプレーンテキストのみとし、Markdown記法(\`**太字**\`、見出しの\`#\`等)は
  一切使わないこと。箇条書きの記号は半角の\`*\`や\`-\`ではなく全角の「・」を使うこと。`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      httpOptions: TREND_HTTP_OPTIONS,
    },
  });

  const rawSummaryText = response.text?.trim();
  if (!rawSummaryText) {
    throw new Error("Gemini API returned an empty trend summary");
  }
  // プロンプトでMarkdownを使わないよう指示していても確実ではないため、保存前に正規化する
  const summaryText = stripMarkdown(rawSummaryText);

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
