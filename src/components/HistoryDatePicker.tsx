"use client";

import { formatJstDateLabel } from "@/lib/date/jst";

export interface DateOption {
  date: string;
  causalDate: string;
}

/** 過去の収集日を選んで、当時のランキング・気象・AI分析結果を一式で切り替えて閲覧するためのセレクタ */
export function HistoryDatePicker({
  dates,
  selectedDate,
  onSelect,
}: {
  dates: DateOption[];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  if (dates.length === 0) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="history-date-picker" className="text-[var(--text-secondary)]">
        表示日
      </label>
      <select
        id="history-date-picker"
        value={selectedDate ?? "latest"}
        onChange={(e) => onSelect(e.target.value === "latest" ? null : e.target.value)}
        className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-primary)]"
      >
        <option value="latest">最新</option>
        {dates.map((d) => (
          <option key={d.date} value={d.date}>
            {formatJstDateLabel(d.date)}
          </option>
        ))}
      </select>
    </div>
  );
}
