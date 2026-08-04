"use client";

import type { DiffHighlightRecord } from "@/lib/db/types";

export interface InsightData {
  timestamp: string;
  aiAnalysisText: string;
  forecastText?: string | null;
  highlights: DiffHighlightRecord[];
  createdAt: string;
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
 * 表示日ピッカーで日付を選べるようになったため、常に「表示中の日の分析1件」だけを渡す想定
 * (呼び出し元のDashboard.tsxが&limit=1または&dateで1件に絞っている)。過去分をこのカード内で
 * 積み重ねて見せる必要が無くなったので、アコーディオンではなく常時展開の単一カードにしている。
 */
export function InsightCard({ insight }: { insight: InsightData }) {
  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-5">
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        {formatDateTime(insight.timestamp)} 時点の分析
      </p>
      <p className="mb-3 text-sm leading-relaxed text-[var(--text-primary)]">
        {insight.aiAnalysisText}
      </p>

      {insight.forecastText && (
        <div className="rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--surface-2)] p-3">
          <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
            🔮 今後の予測
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-primary)]">
            {insight.forecastText}
          </p>
        </div>
      )}
    </div>
  );
}
