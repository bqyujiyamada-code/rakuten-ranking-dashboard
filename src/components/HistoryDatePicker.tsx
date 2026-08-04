"use client";

export interface DateOption {
  date: string;
  causalDate: string;
}

/**
 * 過去の収集日を選んで、当時のランキング・気象・AI分析結果を一式で切り替えて閲覧するための
 * ナビゲーション。収集は1日1回で日々件数が増え続けるため、全件をプルダウンで並べるのではなく
 * 「◀/▶でデータのある前後の日に移動」+「ネイティブの日付入力で任意の日にジャンプ」の
 * 組み合わせにしている(件数が増えてもUIの見た目は変わらない)。
 */
export function HistoryDatePicker({
  dates,
  selectedDate,
  onSelect,
}: {
  /** 新しい順 (dates[0]が最新) */
  dates: DateOption[];
  /** nullは最新を表す */
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  if (dates.length === 0) return null;

  const latestDate = dates[0].date;
  const oldestDate = dates[dates.length - 1].date;
  const currentDate = selectedDate ?? latestDate;

  // データの無い日(日付入力で任意の日を選んだ場合など)からでも、直近のデータがある日へ移動できるよう
  // 隣接indexではなく大小比較で「前後にある、データが存在する日」を探す。
  const prevDate = dates.find((d) => d.date < currentDate)?.date ?? null;
  const nextDate = [...dates].reverse().find((d) => d.date > currentDate)?.date ?? null;

  function handlePick(value: string) {
    onSelect(value === latestDate ? null : value);
  }

  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="mr-1 text-[var(--text-secondary)]">表示日</span>
      <button
        type="button"
        onClick={() => prevDate && handlePick(prevDate)}
        disabled={!prevDate}
        aria-label="データがある前の日へ"
        className="rounded-lg border border-[var(--border-hairline)] px-2 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-2)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ◀
      </button>
      <input
        type="date"
        aria-label="表示日"
        value={currentDate}
        min={oldestDate}
        max={latestDate}
        onChange={(e) => e.target.value && handlePick(e.target.value)}
        className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-primary)]"
      />
      <button
        type="button"
        onClick={() => nextDate && handlePick(nextDate)}
        disabled={!nextDate}
        aria-label="データがある次の日へ"
        className="rounded-lg border border-[var(--border-hairline)] px-2 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-2)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ▶
      </button>
      {currentDate !== latestDate && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="ml-1 text-xs text-[var(--text-muted)] underline decoration-dotted hover:text-[var(--text-secondary)]"
        >
          最新に戻る
        </button>
      )}
    </div>
  );
}
