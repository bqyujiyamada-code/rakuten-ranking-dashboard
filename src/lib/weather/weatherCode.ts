// Open-Meteo が返す WMO Weather interpretation code の日本語ラベル変換表。
// 参考: https://open-meteo.com/en/docs (WMO Weather interpretation codes)

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "快晴",
  1: "晴れ",
  2: "一部曇り",
  3: "曇り",
  45: "霧",
  48: "霧氷を伴う霧",
  51: "弱い霧雨",
  53: "霧雨",
  55: "強い霧雨",
  56: "弱い着氷性の霧雨",
  57: "着氷性の霧雨",
  61: "弱い雨",
  63: "雨",
  65: "強い雨",
  66: "弱い着氷性の雨",
  67: "着氷性の雨",
  71: "弱い雪",
  73: "雪",
  75: "強い雪",
  77: "霧雪",
  80: "弱いにわか雨",
  81: "にわか雨",
  82: "激しいにわか雨",
  85: "弱いにわか雪",
  86: "にわか雪",
  95: "雷雨",
  96: "弱い雹を伴う雷雨",
  99: "強い雹を伴う雷雨",
};

export function weatherCodeToLabel(code: number): string {
  return WEATHER_CODE_LABELS[code] ?? `不明(コード${code})`;
}
