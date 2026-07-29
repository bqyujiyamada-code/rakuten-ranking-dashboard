import { GoogleGenAI } from "@google/genai";
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

function buildPrompt(genreName: string, highlights: DiffHighlightRecord[]): string {
  const bulletList = highlights
    .map((h, i) => `${i + 1}. [${h.type}] ${h.itemName} — ${h.detail}`)
    .join("\n");

  return `あなたは楽天市場のトレンドを分析するECマーケットアナリストです。
以下は「${genreName}」ジャンルの楽天ランキングにおける、前回計測時からの主な変動点です。

${bulletList}

これらの変動から読み取れる消費者トレンドや、変動の背景として考えられる理由(季節性、セール、メディア露出、価格戦略など)を、
日本語で3〜4文程度の簡潔なコメントとして要約してください。断定しすぎず「〜と考えられます」「〜の可能性があります」のような推察のトーンで書いてください。
商品名を箇条書きで繰り返すのではなく、傾向として何が起きているかを説明してください。`;
}

/**
 * 差分ハイライトをもとに、Geminiにトレンド考察コメントを生成させる。
 * ハイライトが空の場合は呼び出さず、呼び出し側でスキップする想定。
 */
export async function generateTrendInsight(
  genreName: string,
  highlights: DiffHighlightRecord[],
): Promise<string> {
  const ai = getClient();
  const prompt = buildPrompt(genreName, highlights);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini API returned an empty response");
  }
  return text;
}
