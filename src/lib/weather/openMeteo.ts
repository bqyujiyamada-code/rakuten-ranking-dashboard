import { weatherCodeToLabel } from "@/lib/weather/weatherCode";

// 東京(気象庁の代表地点に近い座標)。楽天ランキングは全国区のデータのため、
// 消費行動への影響の代理指標として東京の気象を採用する (詳細はCLAUDE.md参照)。
const TOKYO_LATITUDE = 35.6762;
const TOKYO_LONGITUDE = 139.6503;

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoDailyResponse {
  daily?: {
    time: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    weather_code?: number[];
    weathercode?: number[]; // 旧パラメータ名 (APIバージョンによってはこちらで返る)
  };
}

export interface DailyWeatherResult {
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  weatherCode: number;
  weatherLabel: string;
}

/**
 * 指定した日付(JST暦日 "YYYY-MM-DD")の東京の実測気象データを取得する。
 * Open-Meteoの`past_days`は「確定済みの実測値」を返すため、収集当日の朝時点で
 * 前日(causalDate)のデータを取得しても forecast(予報) ではなく確定値になる。
 * APIキー不要・無料。該当日のデータが見つからない場合は null を返す。
 */
export async function fetchTokyoDailyWeather(
  date: string,
): Promise<DailyWeatherResult | null> {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(TOKYO_LATITUDE));
  url.searchParams.set("longitude", String(TOKYO_LONGITUDE));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
  );
  url.searchParams.set("timezone", "Asia/Tokyo");
  // 取得対象日+念のための安全マージン。forecast APIの past_days は実測(確定)値を返す。
  url.searchParams.set("past_days", "3");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText} ${body}`);
  }

  const data = (await res.json()) as OpenMeteoDailyResponse;
  const daily = data.daily;
  if (!daily) return null;

  const index = daily.time.indexOf(date);
  if (index === -1) return null;

  const weatherCodes = daily.weather_code ?? daily.weathercode;
  const tempMaxC = daily.temperature_2m_max?.[index];
  const tempMinC = daily.temperature_2m_min?.[index];
  const precipitationMm = daily.precipitation_sum?.[index];
  const weatherCode = weatherCodes?.[index];

  if (
    tempMaxC === undefined ||
    tempMinC === undefined ||
    precipitationMm === undefined ||
    weatherCode === undefined
  ) {
    return null;
  }

  return {
    tempMaxC,
    tempMinC,
    precipitationMm,
    weatherCode,
    weatherLabel: weatherCodeToLabel(weatherCode),
  };
}
