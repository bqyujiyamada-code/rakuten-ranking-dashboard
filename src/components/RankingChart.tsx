"use client";

import { format } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartSeries {
  itemCode: string;
  itemName: string;
  color: string;
  points: { timestamp: string; rank: number; price: number }[];
}

type ChartField = "rank" | "price";

function mergeSeries(series: ChartSeries[], field: ChartField) {
  const timestamps = Array.from(
    new Set(series.flatMap((s) => s.points.map((p) => p.timestamp))),
  ).sort();

  return timestamps.map((timestamp) => {
    const row: Record<string, number | string> = { timestamp };
    for (const s of series) {
      const point = s.points.find((p) => p.timestamp === timestamp);
      if (point) row[s.itemCode] = point[field];
    }
    return row;
  });
}

function formatTick(timestamp: string) {
  try {
    return format(new Date(timestamp), "M/d HH:mm");
  } catch {
    return timestamp;
  }
}

function CustomTooltip({
  active,
  payload,
  label,
  series,
  valuePrefix,
  valueSuffix,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number }[];
  label?: string;
  series: ChartSeries[];
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="max-w-xs rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 text-[var(--text-muted)]">{label ? formatTick(label) : ""}</div>
      <div className="flex flex-col gap-1">
        {payload
          .filter((entry) => entry.value !== undefined)
          .map((entry) => {
            const s = series.find((item) => item.itemCode === entry.dataKey);
            if (!s) return null;
            return (
              <div key={s.itemCode} className="flex items-center gap-2">
                <span
                  className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">
                  {valuePrefix}
                  {entry.value}
                  {valueSuffix}
                </span>
                <span className="truncate text-[var(--text-secondary)]">{s.itemName}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/**
 * 選択中シリーズの凡例。Rechartsの<Legend>は商品名(数十〜100文字超)を
 * 折り返し表示してしまいレイアウトが崩れるため使わず、
 * 省略表示+クリックで選択解除できる独自の凡例に置き換えている。
 */
function ChartLegend({
  series,
  onRemove,
}: {
  series: ChartSeries[];
  onRemove?: (itemCode: string) => void;
}) {
  // 単一系列の場合は色を判別する必要がなく、グラフタイトルが既に対象を示しているため凡例は不要
  if (series.length <= 1) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {series.map((s) => (
        <button
          key={s.itemCode}
          type="button"
          onClick={() => onRemove?.(s.itemCode)}
          title={s.itemName}
          aria-label={`${s.itemName} を比較から外す`}
          className="flex max-w-[220px] items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--baseline)]"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          <span className="truncate">{s.itemName}</span>
          {onRemove && (
            <span className="shrink-0 text-[var(--text-muted)]" aria-hidden>
              ×
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function TrendLineChart({
  series,
  field,
  reversed,
  valuePrefix,
  valueSuffix,
}: {
  series: ChartSeries[];
  field: ChartField;
  reversed?: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const data = mergeSeries(series, field);

  return (
    <ResponsiveContainer width="100%" height={260}>
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
          reversed={reversed}
          allowDecimals={false}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          stroke="var(--baseline)"
          width={48}
        />
        <Tooltip
          content={
            <CustomTooltip series={series} valuePrefix={valuePrefix} valueSuffix={valueSuffix} />
          }
        />
        {series.map((s) => (
          <Line
            key={s.itemCode}
            type="monotone"
            dataKey={s.itemCode}
            name={s.itemName}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)", fill: s.color }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RankingChart({
  series,
  onRemoveItem,
}: {
  series: ChartSeries[];
  onRemoveItem?: (itemCode: string) => void;
}) {
  if (series.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] text-sm text-[var(--text-muted)]">
        ランキング表から商品を選択すると、順位・価格の推移が表示されます。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <ChartLegend series={series} onRemove={onRemoveItem} />
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
            順位の推移 <span className="font-normal text-[var(--text-muted)]">(上ほど高順位)</span>
          </h3>
          <TrendLineChart series={series} field="rank" reversed valueSuffix="位" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">価格の推移</h3>
          <TrendLineChart series={series} field="price" valuePrefix="¥" />
        </div>
      </div>
    </div>
  );
}
