"use client";

import { format } from "date-fns";
import { displayItemName } from "@/lib/format/itemName";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartItem {
  itemCode: string;
  itemName: string;
  points: { timestamp: string; rank: number; price: number }[];
}

function formatTick(timestamp: string) {
  try {
    return format(new Date(timestamp), "M/d HH:mm");
  } catch {
    return timestamp;
  }
}

const numberFormatter = new Intl.NumberFormat("ja-JP");

const RANK_COLOR = "var(--series-1)";
const PRICE_COLOR = "var(--series-2)";

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="max-w-xs rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 text-[var(--text-muted)]">{label ? formatTick(label) : ""}</div>
      <div className="flex flex-col gap-1">
        {payload
          .filter((entry) => entry.value !== undefined)
          .map((entry) => {
            const isRank = entry.dataKey === "rank";
            const color = isRank ? RANK_COLOR : PRICE_COLOR;
            const formatted = isRank
              ? `${entry.value}位`
              : `¥${numberFormatter.format(entry.value ?? 0)}`;
            return (
              <div key={String(entry.dataKey)} className="flex items-center gap-2">
                <span
                  className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatted}
                </span>
                <span className="text-[var(--text-secondary)]">{isRank ? "順位" : "価格"}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/** 順位・価格の2系列であることを示す固定凡例 (対象商品は1件のため商品ごとの凡例は不要) */
function MetricLegend() {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: RANK_COLOR }} aria-hidden />
        順位 (上ほど高順位)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRICE_COLOR }} aria-hidden />
        価格
      </span>
    </div>
  );
}

export function RankingChart({
  item,
  onClear,
}: {
  item: ChartItem | null;
  onClear?: () => void;
}) {
  if (!item) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] text-sm text-[var(--text-muted)]">
        ランキング表から商品を選択すると、順位・価格の推移が表示されます。
      </div>
    );
  }

  const data = [...item.points]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((p) => ({ timestamp: p.timestamp, rank: p.rank, price: p.price }));

  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3
          className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]"
          title={item.itemName}
        >
          {displayItemName(item.itemName)}
        </h3>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:underline"
          >
            選択解除
          </button>
        )}
      </div>
      <MetricLegend />
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="var(--gridline)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTick}
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            stroke="var(--baseline)"
            minTickGap={32}
          />
          <YAxis
            yAxisId="rank"
            reversed
            allowDecimals={false}
            tick={{ fill: RANK_COLOR, fontSize: 12 }}
            stroke="var(--baseline)"
            width={48}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            tick={{ fill: PRICE_COLOR, fontSize: 12 }}
            stroke="var(--baseline)"
            width={64}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            yAxisId="rank"
            type="monotone"
            dataKey="rank"
            name="順位"
            stroke={RANK_COLOR}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)", fill: RANK_COLOR }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            name="価格"
            stroke={PRICE_COLOR}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)", fill: PRICE_COLOR }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
