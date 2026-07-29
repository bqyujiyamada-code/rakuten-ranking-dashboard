"use client";

import type { DiffHighlightRecord, DiffHighlightType } from "@/lib/db/types";

export interface InsightData {
  timestamp: string;
  aiAnalysisText: string;
  highlights: DiffHighlightRecord[];
  createdAt: string;
}

const HIGHLIGHT_META: Record<DiffHighlightType, { label: string; color: string }> = {
  NEW_ENTRY: { label: "★ NEW", color: "var(--series-1)" },
  RANK_SURGE: { label: "▲ 上昇", color: "var(--status-good)" },
  RANK_DROP: { label: "▼ 下降", color: "var(--status-critical)" },
  PRICE_DROP: { label: "¥ 値下げ", color: "var(--status-good)" },
  PRICE_UP: { label: "¥ 値上げ", color: "var(--status-warning)" },
};

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

export function InsightCard({
  insight,
  isLatest,
}: {
  insight: InsightData;
  isLatest?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)]">
          {formatDateTime(insight.timestamp)} 時点の分析
        </span>
        {isLatest && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: "var(--series-1)" }}
          >
            最新
          </span>
        )}
      </div>

      <p className="mb-3 text-sm leading-relaxed text-[var(--text-primary)]">
        {insight.aiAnalysisText}
      </p>

      {insight.highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {insight.highlights.map((highlight, index) => {
            const meta = HIGHLIGHT_META[highlight.type];
            return (
              <span
                key={`${highlight.itemCode}-${index}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                style={{ borderColor: meta.color, color: meta.color }}
                title={highlight.detail}
              >
                <span className="shrink-0">{meta.label}</span>
                <span className="truncate">{highlight.itemName}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
