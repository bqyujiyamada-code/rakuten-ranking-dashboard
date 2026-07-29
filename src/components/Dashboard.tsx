"use client";

import { useEffect, useRef, useState } from "react";
import { GenreSelector, type GenreOption } from "@/components/GenreSelector";
import { RankingLeaderboard, type LeaderboardItem } from "@/components/RankingLeaderboard";
import { RankingChart, type ChartSeries } from "@/components/RankingChart";
import { InsightCard, type InsightData } from "@/components/InsightCard";

const MAX_SELECTED_ITEMS = 5;

const SERIES_COLORS_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const SERIES_COLORS_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];

interface TimeSeriesPoint {
  timestamp: string;
  rank: number;
  price: number;
}

/** DB/外部APIの一時的な障害でダッシュボード全体がクラッシュしないよう、失敗時はフォールバック値を返す */
async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Request failed: ${url} (${res.status})`);
      return fallback;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error(`Request failed: ${url}`, error);
    return fallback;
  }
}

function usePaletteColors(): string[] {
  const [isDark, setIsDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isDark ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT;
}

export function Dashboard() {
  const paletteColors = usePaletteColors();

  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(null);

  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [loadedGenreId, setLoadedGenreId] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightData[]>([]);

  const [selectedItemCodes, setSelectedItemCodes] = useState<string[]>([]);
  const [colorAssignments, setColorAssignments] = useState<Record<string, string>>({});
  const [seriesCache, setSeriesCache] = useState<Record<string, TimeSeriesPoint[]>>({});
  const fetchedSeriesKeys = useRef(new Set<string>());

  // ジャンルマスタの初期取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await safeFetchJson<{ genres: GenreOption[] }>("/api/genres", {
        genres: [],
      });
      if (cancelled) return;
      setGenres(data.genres);
      if (data.genres.length) {
        setSelectedGenreId(data.genres[0].genreId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 選択ジャンルの順位表 + AIインサイト取得
  useEffect(() => {
    if (!selectedGenreId) return;
    let cancelled = false;

    (async () => {
      const [rankData, insightData] = await Promise.all([
        safeFetchJson<{ items: LeaderboardItem[] }>(
          `/api/rankings?genreId=${encodeURIComponent(selectedGenreId)}`,
          { items: [] },
        ),
        safeFetchJson<{ insights: InsightData[] }>(
          `/api/insights?genreId=${encodeURIComponent(selectedGenreId)}&limit=5`,
          { insights: [] },
        ),
      ]);
      if (cancelled) return;
      setLeaderboard(rankData.items);
      setInsights(insightData.insights);
      setLoadedGenreId(selectedGenreId);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGenreId]);

  const isLeaderboardLoading = selectedGenreId !== null && selectedGenreId !== loadedGenreId;

  // 選択された商品の時系列データ取得 (未取得分のみ)
  useEffect(() => {
    if (!selectedGenreId) return;
    const toFetch = selectedItemCodes.filter(
      (itemCode) => !fetchedSeriesKeys.current.has(`${selectedGenreId}:${itemCode}`),
    );
    if (toFetch.length === 0) return;
    toFetch.forEach((itemCode) =>
      fetchedSeriesKeys.current.add(`${selectedGenreId}:${itemCode}`),
    );

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        toFetch.map(async (itemCode) => {
          const data = await safeFetchJson<{ series: TimeSeriesPoint[] }>(
            `/api/rankings?genreId=${encodeURIComponent(selectedGenreId)}&itemCode=${encodeURIComponent(itemCode)}`,
            { series: [] },
          );
          return [itemCode, data.series] as const;
        }),
      );
      if (cancelled) return;
      setSeriesCache((prev) => {
        const next = { ...prev };
        for (const [itemCode, points] of entries) {
          next[`${selectedGenreId}:${itemCode}`] = points;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedItemCodes, selectedGenreId]);

  function handleSelectGenre(genreId: string) {
    setSelectedGenreId(genreId);
    setSelectedItemCodes([]);
    setColorAssignments({});
  }

  // 色の割り当ては選択操作の瞬間に確定させる。解除したアイテムの色は
  // 他の選択中アイテムには引き継がれず、空いた枠として次の新規選択に回る。
  function handleToggleItem(itemCode: string) {
    if (selectedItemCodes.includes(itemCode)) {
      setSelectedItemCodes(selectedItemCodes.filter((code) => code !== itemCode));
      const nextColors = { ...colorAssignments };
      delete nextColors[itemCode];
      setColorAssignments(nextColors);
      return;
    }

    if (selectedItemCodes.length >= MAX_SELECTED_ITEMS) return;

    const usedColors = new Set(Object.values(colorAssignments));
    const color = paletteColors.find((c) => !usedColors.has(c));
    if (!color) return;

    setSelectedItemCodes([...selectedItemCodes, itemCode]);
    setColorAssignments({ ...colorAssignments, [itemCode]: color });
  }

  const chartSeries: ChartSeries[] = selectedItemCodes
    .map((itemCode): ChartSeries | null => {
      const item = leaderboard.find((i) => i.itemCode === itemCode);
      const color = colorAssignments[itemCode];
      if (!item || !color || !selectedGenreId) return null;
      return {
        itemCode,
        itemName: item.itemName,
        color,
        points: seriesCache[`${selectedGenreId}:${itemCode}`] ?? [],
      };
    })
    .filter((s): s is ChartSeries => s !== null);

  const selectedGenreName =
    genres.find((g) => g.genreId === selectedGenreId)?.name ?? "";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          楽天ランキング トレンドダッシュボード
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          定期収集したランキングの推移と、AIによる変動分析を確認できます。
        </p>
      </header>

      <GenreSelector
        genres={genres}
        selectedGenreId={selectedGenreId}
        onSelect={handleSelectGenre}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
            {selectedGenreName ? `${selectedGenreName}のランキング` : "ランキング"}
            <span className="ml-2 font-normal text-[var(--text-muted)]">
              (最大{MAX_SELECTED_ITEMS}件まで比較可能)
            </span>
          </h2>
          <RankingLeaderboard
            items={leaderboard}
            selectedItemCodes={selectedItemCodes}
            colorFor={(itemCode) => colorAssignments[itemCode]}
            onToggle={handleToggleItem}
            maxSelected={MAX_SELECTED_ITEMS}
            isLoading={isLeaderboardLoading}
          />
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            AIトレンド分析
          </h2>
          {insights.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)] p-6 text-sm text-[var(--text-muted)]">
              このジャンルではまだ有意な変動が検知されていません。収集が2回以上行われると表示されます。
            </div>
          ) : (
            insights.map((insight, index) => (
              <InsightCard key={insight.timestamp} insight={insight} isLatest={index === 0} />
            ))
          )}
        </div>
      </div>

      {/* グラフは商品名の凡例が長くなるため、狭い列に収めず全幅で表示する */}
      <RankingChart series={chartSeries} onRemoveItem={handleToggleItem} />
    </div>
  );
}
