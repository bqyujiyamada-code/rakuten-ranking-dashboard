import {
  getDailyBundle,
  getGenreMeta,
  getHighlightsAtTimestamp,
  getInsightAtTimestamp,
} from "@/lib/db/rankingRepository";

/**
 * GET /api/insights?genreId=xxx                 -> 最新収集時点のAI分析+ハイライト
 * GET /api/insights?genreId=xxx&date=YYYY-MM-DD  -> 指定日(JST収集日)時点のAI分析+ハイライト
 *
 * 表示対象の日は常に1件のみ(InsightCard.tsx参照、複数日分の積み上げ表示はしない設計)。
 * タイムスタンプの解決を「その日の収集バッチが使ったtimestamp」(dateありならDAY#バンドル、
 * 最新表示ならGenreMetaのlatestTimestamp)で先に決め、AI分析(InsightItem)とハイライト
 * (DiffHighlightsItem)を独立に引く。Gemini分析が失敗した日でもGenreMeta/ハイライトの
 * 保存は必ず行われるため(collectAndAnalyze.ts参照)、AI分析文だけが欠けていても
 * ハイライトはランキング表に表示できる。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genreId = searchParams.get("genreId");
  const date = searchParams.get("date");

  if (!genreId) {
    return Response.json({ error: "genreId is required" }, { status: 400 });
  }

  try {
    const timestamp = date
      ? (await getDailyBundle(date))?.timestamp ?? null
      : (await getGenreMeta(genreId))?.latestTimestamp ?? null;

    if (!timestamp) {
      return Response.json({ genreId, date: date ?? null, insights: [] });
    }

    const [insight, highlightsItem] = await Promise.all([
      getInsightAtTimestamp(genreId, timestamp),
      getHighlightsAtTimestamp(genreId, timestamp),
    ]);

    // highlightsItemが無い場合、2026-08-06対応より前に書き込まれた過去レコードなら
    // InsightItem側に埋め込まれたままの可能性があるので後方互換フォールバックする。
    const highlights = highlightsItem?.highlights ?? insight?.highlights ?? [];

    if (!insight && highlights.length === 0) {
      return Response.json({ genreId, date: date ?? null, insights: [] });
    }

    return Response.json({
      genreId,
      date: date ?? null,
      insights: [
        {
          timestamp,
          aiAnalysisText: insight?.aiAnalysisText ?? null,
          forecastText: insight?.forecastText ?? null,
          highlights,
          createdAt: insight?.createdAt ?? highlightsItem?.createdAt ?? timestamp,
        },
      ],
    });
  } catch (error) {
    console.error(`[api/insights] Failed for genreId=${genreId}`, error);
    return Response.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
