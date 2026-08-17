import {
  getDailyBundle,
  getItemTimeSeries,
  getLatestSnapshot,
  getSnapshotAtTimestamp,
} from "@/lib/db/rankingRepository";

/**
 * GET /api/rankings?genreId=xxx                 -> 直近の順位表 (leaderboard)
 * GET /api/rankings?genreId=xxx&date=YYYY-MM-DD  -> 指定日(JST収集日)時点の順位表 (バックナンバー)
 * GET /api/rankings?genreId=xxx&itemCode=y       -> 特定商品の順位・価格の時系列 (dateは無視)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genreId = searchParams.get("genreId");
  const itemCode = searchParams.get("itemCode");
  const date = searchParams.get("date");

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

    const snapshot = date
      ? await (async () => {
          const bundle = await getDailyBundle(date);
          if (!bundle) return [];
          return getSnapshotAtTimestamp(genreId, bundle.timestamp);
        })()
      : await getLatestSnapshot(genreId);

    return Response.json({
      genreId,
      date: date ?? null,
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
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
