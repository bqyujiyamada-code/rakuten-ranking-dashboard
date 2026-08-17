// 日本時間(JST)基準の日付操作ユーティリティ。
// 収集Cronは `new Date().toISOString()` (UTC) を基準に動くため、
// 「収集日」「気象・トレンドの対象日」をJSTの暦日として扱う処理をここに集約する。
// 例: 22:00 UTC = 翌7:00 JST のため、単純に `.toISOString()` の日付部分を使うと1日ずれる。

const JST_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const JST_DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

/** DateをJSTの暦日として "YYYY-MM-DD" 形式にする (sv-SEロケールがこの形式を返すことを利用) */
export function toJstDateString(date: Date): string {
  return JST_DATE_KEY_FORMATTER.format(date);
}

/** "YYYY-MM-DD" (JST暦日) に日数を加算/減算する。時刻情報は持たないため正午UTCを経由して日境界のズレを避ける */
export function addDaysJst(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  noonUtc.setUTCDate(noonUtc.getUTCDate() + deltaDays);
  return toJstDateString(noonUtc);
}

/** 現在時刻のJST暦月を "YYYY-MM" 形式にする */
export function currentJstMonth(): string {
  return toJstDateString(new Date()).slice(0, 7);
}

/** "YYYY-MM" (JST暦月) の前月を "YYYY-MM" 形式にする */
export function previousJstMonth(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(year, monthNum - 1, 1));
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" (JST暦日) を日本語の日付ラベルにする (例: 2026年8月3日月曜日) */
export function formatJstDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  // ラベル整形のみが目的のため、時刻はJST正午相当のUTCで固定して日付ズレを避ける
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  return JST_DATE_LABEL_FORMATTER.format(noonUtc);
}
