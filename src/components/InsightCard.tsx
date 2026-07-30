"use client";

import { displayItemName } from "@/lib/format/itemName";
import type { DiffHighlightRecord, DiffHighlightType } from "@/lib/db/types";

export interface InsightData {
  timestamp: string;
  aiAnalysisText: string;
  forecastText?: string | null;
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

/** hoverしなくても分かるよう、順位/価格の変動をバッジ本体に短く表示する */
function movementLabel(highlight: DiffHighlightRecord): string | null {
  switch (highlight.type) {
    case "NEW_ENTRY":
      return highlight.currentRank !== undefined ? `${highlight.currentRank}位` : null;
    case "RANK_SURGE":
    case "RANK_DROP":
      return highlight.previousRank !== undefined && highlight.currentRank !== undefined
        ? `${highlight.previousRank}→${highlight.currentRank}位`
        : null;
    case "PRICE_DROP":
    case "PRICE_UP": {
      if (highlight.previousPrice === undefined || highlight.currentPrice === undefined) {
        return null;
      }
      if (highlight.previousPrice <= 0) return null;
      const pct = Math.round(
        ((highlight.currentPrice - highlight.previousPrice) / highlight.previousPrice) * 100,
      );
      return `${pct > 0 ? "+" : ""}${pct}%`;
    }
    default:
      return null;
  }
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

export function InsightCard({
  insight,
  isLatest,
}: {
  insight: InsightData;
  isLatest?: boolean;
}) {
  return (
    <details
      open={isLatest}
      className="group rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]"
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-2 p-5 [&::-webkit-details-marker]:hidden group-open:pb-3"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-[var(--text-muted)]">
            {formatDateTime(insight.timestamp)} 時点の分析
          </span>
          {isLatest && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: "var(--series-1)" }}
            >
              最新
            </span>
          )}
          <span className="truncate text-xs text-[var(--text-muted)] group-open:hidden">
            {insight.aiAnalysisText}
          </span>
        </span>
        <svg
          className="size-4 shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-180"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </summary>

      <div className="px-5 pb-5">
        <p className="mb-3 text-sm leading-relaxed text-[var(--text-primary)]">
          {insight.aiAnalysisText}
        </p>

        {insight.forecastText && (
          <div className="mb-3 rounded-lg border border-dashed border-[var(--border-hairline)] bg-[var(--surface-2)] p-3">
            <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
              🔮 今後の予測
            </p>
            <p className="text-sm leading-relaxed text-[var(--text-primary)]">
              {insight.forecastText}
            </p>
          </div>
        )}

        {insight.highlights.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {insight.highlights.map((highlight, index) => {
              const meta = HIGHLIGHT_META[highlight.type];
              const movement = movementLabel(highlight);
              return (
                <span
                  key={`${highlight.itemCode}-${index}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                  style={{ borderColor: meta.color, color: meta.color }}
                  title={`${highlight.itemName} — ${highlight.detail}`}
                >
                  <span className="shrink-0">{meta.label}</span>
                  {movement && (
                    <span className="shrink-0 font-semibold tabular-nums">{movement}</span>
                  )}
                  <span className="truncate">{displayItemName(highlight.itemName)}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
