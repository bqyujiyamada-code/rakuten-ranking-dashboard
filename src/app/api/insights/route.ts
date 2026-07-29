import { listInsights } from "@/lib/db/rankingRepository";

/** GET /api/insights?genreId=xxx&limit=10 -> AIトレンド分析コメントの履歴 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genreId = searchParams.get("genreId");
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;

  if (!genreId) {
    return Response.json({ error: "genreId is required" }, { status: 400 });
  }

  try {
    const insights = await listInsights(genreId, limit);
    return Response.json({
      genreId,
      insights: insights.map((insight) => ({
        timestamp: insight.timestamp,
        aiAnalysisText: insight.aiAnalysisText,
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
