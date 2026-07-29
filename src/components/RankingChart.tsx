"use client";

import { format } from "date-fns";
import {
  CartesianGrid,
  Legend,
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
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-xs shadow-sm">
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
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {valuePrefix}
                  {entry.value}
                  {valueSuffix}
                </span>
                <span className="line-clamp-1 text-[var(--text-secondary)]">{s.itemName}</span>
              </div>
            );
          })}
      </div>
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
  const showLegend = series.length > 1;

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
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
            formatter={(_value, entry) => {
              const s = series.find((item) => item.itemCode === (entry as { dataKey?: string }).dataKey);
              return (
                <span style={{ color: "var(--text-secondary)" }}>{s?.itemName ?? ""}</span>
              );
            }}
          />
        )}
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

export function RankingChart({ series }: { series: ChartSeries[] }) {
  if (series.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] text-sm text-[var(--text-muted)]">
        ランキング表から商品を選択すると、順位・価格の推移が表示されます。
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          順位の推移 <span className="font-normal text-[var(--text-muted)]">(上ほど高順位)</span>
        </h3>
        <TrendLineChart series={series} field="rank" reversed valueSuffix="位" />
      </div>
      <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">価格の推移</h3>
        <TrendLineChart series={series} field="price" valuePrefix="¥" />
      </div>
    </div>
  );
}
