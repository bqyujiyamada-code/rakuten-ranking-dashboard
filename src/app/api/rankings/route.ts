import { getItemTimeSeries, getLatestSnapshot } from "@/lib/db/rankingRepository";

/**
 * GET /api/rankings?genreId=xxx           -> 直近の順位表 (leaderboard)
 * GET /api/rankings?genreId=xxx&itemCode=y -> 特定商品の順位・価格の時系列
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genreId = searchParams.get("genreId");
  const itemCode = searchParams.get("itemCode");

  if (!genreId) {
    return Response.json({ error: "genreId is required" }, { status: 400 });
  }

  try {
    if (itemCode) {
      const series = await getItemTimeSeries(genreId, itemCode);
      return Response.json({
        genreId,
        itemCode,
        series: series.map((s) => ({
          timestamp: s.capturedAt,
          rank: s.rank,
          price: s.price,
        })),
      });
    }

    const snapshot = await getLatestSnapshot(genreId);
    return Response.json({
      genreId,
      items: snapshot.map((s) => ({
        itemCode: s.itemCode,
        itemName: s.itemName,
        rank: s.rank,
        price: s.price,
        itemUrl: s.itemUrl,
        imageUrl: s.imageUrl,
        shopName: s.shopName,
        capturedAt: s.capturedAt,
      })),
    });
  } catch (error) {
    console.error(`[api/rankings] Failed for genreId=${genreId}`, error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
