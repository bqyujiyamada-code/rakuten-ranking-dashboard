import {
  getDailyBundle,
  getInsightAtTimestamp,
  listInsights,
} from "@/lib/db/rankingRepository";
import type { InsightItem } from "@/lib/db/types";

/**
 * GET /api/insights?genreId=xxx&limit=10        -> AIトレンド分析コメントの履歴(最新順)
 * GET /api/insights?genreId=xxx&date=YYYY-MM-DD -> 指定日(JST収集日)時点のインサイト1件 (バックナンバー)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genreId = searchParams.get("genreId");
  const date = searchParams.get("date");
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;

  if (!genreId) {
    return Response.json({ error: "genreId is required" }, { status: 400 });
  }

  try {
    const insights: InsightItem[] = date
      ? await (async () => {
          const bundle = await getDailyBundle(date);
          if (!bundle) return [];
          const insight = await getInsightAtTimestamp(genreId, bundle.timestamp);
          return insight ? [insight] : [];
        })()
      : await listInsights(genreId, limit);

    return Response.json({
      genreId,
      date: date ?? null,
      insights: insights.map((insight) => ({
        timestamp: insight.timestamp,
        aiAnalysisText: insight.aiAnalysisText,
        forecastText: insight.forecastText ?? null,
        highlights: insight.highlights,
        createdAt: insight.createdAt,
      })),
    });
  } catch (error) {
    console.error(`[api/insights] Failed for genreId=${genreId}`, error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
