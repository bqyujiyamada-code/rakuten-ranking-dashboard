"use client";

export interface GenreOption {
  genreId: string;
  name: string;
}

/**
 * 16件のジャンルをボタン(pill)で並べると数行にわたり縦のスペースを取りすぎるため、
 * PC表示でも場所を取らないネイティブのプルダウンに変更した(HistoryDatePickerと
 * 見た目を揃えている)。
 */
export function GenreSelector({
  genres,
  selectedGenreId,
  onSelect,
}: {
  genres: GenreOption[];
  selectedGenreId: string | null;
  onSelect: (genreId: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--text-secondary)]">ジャンル</span>
      <select
        aria-label="ジャンル選択"
        value={selectedGenreId ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-primary)]"
      >
        {genres.map((genre) => (
          <option key={genre.genreId} value={genre.genreId}>
            {genre.name}
          </option>
        ))}
      </select>
    </label>
  );
}
