import { listRecentDailyBundles } from "@/lib/db/rankingRepository";

/** GET /api/dates?limit=90 -> バックナンバー閲覧用に、収集済みの日付一覧を新しい順で返す */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 90;

  try {
    const bundles = await listRecentDailyBundles(limit);
    return Response.json({
      dates: bundles.map((bundle) => ({
        date: bundle.date,
        causalDate: bundle.causalDate,
      })),
    });
  } catch (error) {
    console.error("[api/dates] Failed", error);
    return Response.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
