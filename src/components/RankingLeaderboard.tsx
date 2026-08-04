"use client";

import { displayItemName } from "@/lib/format/itemName";
import { HIGHLIGHT_META, movementLabel } from "@/lib/format/highlight";
import type { DiffHighlightRecord } from "@/lib/db/types";

export interface LeaderboardItem {
  itemCode: string;
  itemName: string;
  rank: number;
  price: number;
  itemUrl: string;
  imageUrl?: string;
  shopName?: string;
}

const priceFormatter = new Intl.NumberFormat("ja-JP");

export function RankingLeaderboard({
  items,
  selectedItemCode,
  highlightFor,
  onSelect,
  isLoading,
}: {
  items: LeaderboardItem[];
  selectedItemCode: string | null;
  highlightFor: (itemCode: string) => DiffHighlightRecord | undefined;
  onSelect: (itemCode: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">
        読み込み中...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">
        このジャンルのランキングデータはまだありません。収集バッチの実行後に表示されます。
      </div>
    );
  }

  return (
    <div className="max-h-[520px] overflow-y-auto overflow-x-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="sticky top-0 z-10 bg-[var(--surface-1)]">
          <tr className="border-b border-[var(--gridline)] text-left text-xs text-[var(--text-muted)]">
            <th className="w-10 px-3 py-2 font-medium">表示</th>
            <th className="w-14 px-3 py-2 font-medium">順位</th>
            <th className="w-32 px-3 py-2 font-medium">変動</th>
            <th className="px-3 py-2 font-medium">商品名</th>
            <th className="px-3 py-2 text-right font-medium">価格</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isSelected = item.itemCode === selectedItemCode;
            const highlight = highlightFor(item.itemCode);
            const meta = highlight ? HIGHLIGHT_META[highlight.type] : null;
            const movement = highlight ? movementLabel(highlight) : null;

            return (
              <tr
                key={item.itemCode}
                onClick={() => onSelect(item.itemCode)}
                className={`cursor-pointer border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--surface-2)] ${
                  isSelected ? "bg-[var(--surface-2)]" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <input
                    type="radio"
                    name="chart-item"
                    checked={isSelected}
                    onChange={() => onSelect(item.itemCode)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`${item.itemName}の順位・価格推移を表示`}
                  />
                </td>
                <td className="px-3 py-2 font-medium tabular-nums text-[var(--text-secondary)]">
                  {item.rank}
                </td>
                <td className="px-3 py-2">
                  {highlight && meta && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                      style={{ borderColor: meta.color, color: meta.color }}
                      title={highlight.detail}
                    >
                      <span className="shrink-0">{meta.label}</span>
                      {movement && (
                        <span className="shrink-0 font-semibold tabular-nums">{movement}</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <a
                    href={item.itemUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="line-clamp-1 hover:underline"
                    title={item.itemName}
                  >
                    {displayItemName(item.itemName)}
                  </a>
                  {item.shopName && (
                    <div className="text-xs text-[var(--text-muted)]">{item.shopName}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ¥{priceFormatter.format(item.price)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
