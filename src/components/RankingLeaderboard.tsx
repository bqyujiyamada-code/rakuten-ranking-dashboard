"use client";

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
  selectedItemCodes,
  colorFor,
  onToggle,
  maxSelected,
  isLoading,
}: {
  items: LeaderboardItem[];
  selectedItemCodes: string[];
  colorFor: (itemCode: string) => string | undefined;
  onToggle: (itemCode: string) => void;
  maxSelected: number;
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
    <div className="overflow-x-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-xs text-[var(--text-muted)]">
            <th className="w-10 px-3 py-2 font-medium">比較</th>
            <th className="w-14 px-3 py-2 font-medium">順位</th>
            <th className="px-3 py-2 font-medium">商品名</th>
            <th className="px-3 py-2 text-right font-medium">価格</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isSelected = selectedItemCodes.includes(item.itemCode);
            const color = colorFor(item.itemCode);
            const disabled = !isSelected && selectedItemCodes.length >= maxSelected;

            return (
              <tr
                key={item.itemCode}
                className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--surface-2)]"
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => onToggle(item.itemCode)}
                    aria-label={`${item.itemName}を比較対象に追加`}
                    style={isSelected ? { accentColor: color } : undefined}
                  />
                </td>
                <td className="px-3 py-2 font-medium tabular-nums text-[var(--text-secondary)]">
                  {item.rank}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                    )}
                    <a
                      href={item.itemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-1 hover:underline"
                      title={item.itemName}
                    >
                      {item.itemName}
                    </a>
                  </div>
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
