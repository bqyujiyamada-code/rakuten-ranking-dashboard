import type { DiffHighlightRecord, DiffHighlightType } from "@/lib/db/types";

export const HIGHLIGHT_META: Record<DiffHighlightType, { label: string; color: string }> = {
  NEW_ENTRY: { label: "★ NEW", color: "var(--series-1)" },
  RANK_SURGE: { label: "▲ 上昇", color: "var(--status-good)" },
  RANK_DROP: { label: "▼ 下降", color: "var(--status-critical)" },
  PRICE_DROP: { label: "¥ 値下げ", color: "var(--status-good)" },
  PRICE_UP: { label: "¥ 値上げ", color: "var(--status-warning)" },
};

/** hoverしなくても分かるよう、順位/価格の変動を短い文字列で表す */
export function movementLabel(highlight: DiffHighlightRecord): string | null {
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
