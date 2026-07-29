"use client";

export interface GenreOption {
  genreId: string;
  name: string;
}

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
    <div
      role="tablist"
      aria-label="ジャンル選択"
      className="flex flex-wrap gap-2"
    >
      {genres.map((genre) => {
        const isSelected = genre.genreId === selectedGenreId;
        return (
          <button
            key={genre.genreId}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(genre.genreId)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              isSelected
                ? "border-transparent text-white"
                : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
            }`}
            style={isSelected ? { backgroundColor: "var(--series-1)" } : undefined}
          >
            {genre.name}
          </button>
        );
      })}
    </div>
  );
}
