import {
  getDailyBundle,
  getTrendDaily,
  getWeatherDaily,
  listRecentDailyBundles,
} from "@/lib/db/rankingRepository";

/**
 * GET /api/daily-context?date=YYYY-MM-DD -> 指定したランキング収集日の判断材料
 *   (前日=causalDateの気象・世間のトレンド) を返す。dateを省略すると最新の収集日を使う。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  try {
    const bundle = date
      ? await getDailyBundle(date)
      : (await listRecentDailyBundles(1))[0];

    if (!bundle) {
      return Response.json({ date: date ?? null, causalDate: null, weather: null, trend: null });
    }

    const [weather, trend] = await Promise.all([
      getWeatherDaily(bundle.causalDate),
      getTrendDaily(bundle.causalDate),
    ]);

    return Response.json({
      date: bundle.date,
      causalDate: bundle.causalDate,
      weather: weather
        ? {
            location: weather.location,
            tempMaxC: weather.tempMaxC,
            tempMinC: weather.tempMinC,
            precipitationMm: weather.precipitationMm,
            weatherLabel: weather.weatherLabel,
          }
        : null,
      trend: trend
        ? {
            summaryText: trend.summaryText,
            sources: trend.sources,
          }
        : null,
    });
  } catch (error) {
    console.error("[api/daily-context] Failed", error);
    return Response.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
