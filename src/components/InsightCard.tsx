"use client";

import type { DiffHighlightRecord } from "@/lib/db/types";
import { formatJstDateLabel } from "@/lib/date/jst";

export interface InsightData {
  timestamp: string;
  aiAnalysisText: string;
  forecastText?: string | null;
  highlights: DiffHighlightRecord[];
  createdAt: string;
}

export interface DailyContextWeather {
  location: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  weatherLabel: string;
}

export interface DailyContextTrend {
  summaryText: string;
  sources: { title: string; uri: string }[];
}

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

/**
 * ニュース記事のリード文のように、最初の1文を見出し(太字・大きめ)として切り出し、
 * 残りを本文として扱う。aiAnalysisTextは3〜4文の日本語プローズ(gemini.tsのプロンプト参照)
 * のため、句点(「。」)で区切るだけで自然な見出し+本文になる。区切れない場合は全文を
 * 見出し扱いにする。
 */
function splitHeadline(text: string): { headline: string; body: string } {
  const idx = text.indexOf("。");
  if (idx === -1 || idx === text.length - 1) {
    return { headline: text, body: "" };
  }
  return { headline: text.slice(0, idx + 1), body: text.slice(idx + 1).trim() };
}

/**
 * ページ上部に全幅で表示する「本日のAIサマリー」カード。ニュースの見出し記事のような
 * ビジュアル(見出し+本文+関連情報)にし、判断材料(気象・世間のトレンド)も同じカード内に
 * まとめて表示する。表示日ピッカーで選べる日は常に1件のみのため、複数日分を積み重ねる
 * アコーディオン等には戻さないこと(CLAUDE.md参照)。
 */
export function InsightCard({
  insight,
  genreName,
  weather,
  trend,
  causalDate,
}: {
  insight: InsightData | null;
  genreName: string;
  weather?: DailyContextWeather | null;
  trend?: DailyContextTrend | null;
  causalDate?: string | null;
}) {
  const { headline, body } = insight
    ? splitHeadline(insight.aiAnalysisText)
    : { headline: "", body: "" };

  return (
    <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-5 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
          style={{ backgroundColor: "var(--series-1)" }}
        >
          📰 本日のAIサマリー
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {genreName}
          {insight ? ` ・ ${formatDateTime(insight.timestamp)}時点` : ""}
        </span>
      </div>

      {insight ? (
        <>
          <p className="text-lg font-bold leading-snug text-[var(--text-primary)] md:text-xl">
            {headline}
          </p>
          {body && (
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
          )}

          {insight.forecastText && (
            <div
              className="mt-4 rounded-lg border-l-4 bg-[var(--surface-2)] py-2 pl-3 pr-3"
              style={{ borderColor: "var(--series-2)" }}
            >
              <p className="mb-1 text-xs font-semibold" style={{ color: "var(--series-2)" }}>
                🔮 今後の予測
              </p>
              <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                {insight.forecastText}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          このジャンルではまだ有意な変動が検知されていません。収集が2回以上行われると表示されます。
        </p>
      )}

      {(weather || trend) && (
        <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
          <p className="mb-1.5 text-xs font-medium text-[var(--text-muted)]">
            🌤 分析の判断材料
            {causalDate ? ` (前日 ${formatJstDateLabel(causalDate)} の東京)` : ""}
          </p>
          {weather && (
            <p className="text-xs text-[var(--text-secondary)]">
              最高{weather.tempMaxC}°C / 最低{weather.tempMinC}°C・降水量
              {weather.precipitationMm}mm・{weather.weatherLabel}
            </p>
          )}
          {trend && (
            <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[var(--text-secondary)]">
              {trend.summaryText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
