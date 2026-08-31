import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/config/env";
import { formatJstDateLabel } from "@/lib/date/jst";
import { stripMarkdown } from "@/lib/format/markdown";

// 2026-08-31(対応41.): 対応40.で切り替えた`gemini-3.5-flash`も、対応40.以前の
// `gemini-3-flash-preview`と全く同じ症状 — googleSearch grounding付きの呼び出しが
// 503(high demand)/504(DEADLINE_EXCEEDED)、または30〜65秒かかった末にタイムアウト — を
// 再発させ、8/31分のトレンド要約が collect / retry の両cronで取得できなくなった
// (本番で`trend: null`、ローカル再現でも 0/2 成功)。同時刻に複数モデルを実測したところ、
// `gemini-flash-lite-latest`だけが grounding付きで 4〜6秒・ソース4〜7件で 5/5 安定成功した
// (`gemini-flash-latest`は48秒 or 503、`gemini-3.7-flash`は504で、いずれも45秒予算に乗らない)。
// grounding付き要約はモデルの構造化出力の精度をさほど要求しない(3〜5個の箇条書き)ため、
// lite系でも実用上の要約品質に問題はないと判断した。
//
// preview版・特定GAバージョンのピン留めは高負荷時に軒並み落ちることが対応33./40./41.で
// 3回繰り返し確認されたため、あえて floating alias(`-latest`)を採用してGoogle側の
// ルーティングに委ねる。次に同種の障害が起きたら、まず上記の実測手順(複数モデルを
// 同時刻に叩く。`_t3.mjs`が雛形)を再実行して、その時点で grounding付きで安定している
// モデルへ差し替えること。
//
// responseSchema(構造化出力)は引き続きgoogleSearchと同時利用できないので、gemini.tsとは
// 別のプレーンテキスト呼び出しとして分離する設計は変えていない。
const MODEL = "gemini-flash-lite-latest";

// この呼び出しは`collectAndAnalyze.ts`でフェーズ1(楽天APIのランキング収集、レート制限に
// より直列・概算70秒)と並行して開始されるため、フェーズ1の待ち時間にほぼ相乗りできる
// (詳細はCLAUDE.md参照)。1日1回だけの呼び出しであることも踏まえ、gemini.tsの
// GEMINI_HTTP_OPTIONSと同じ理由(SDK既定の5回リトライで予算を溶かさないため)で上限を
// 明示的に2に固定している。`gemini-flash-lite-latest`は grounding付きでも実測4〜6秒で
// 応答するが、高負荷時のブレを見て余裕をもたせ 30秒(× 2回で最悪60秒、フェーズ1の
// 70秒待ちに収まる)としている。SDK既定のリトライ回数(5回)には戻さないこと(対応26.)。
const TREND_HTTP_OPTIONS = {
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
