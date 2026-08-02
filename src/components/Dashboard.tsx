"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GenreSelector, type GenreOption } from "@/components/GenreSelector";
import { RankingLeaderboard, type LeaderboardItem } from "@/components/RankingLeaderboard";
import { RankingChart, type ChartItem } from "@/components/RankingChart";
import { InsightCard, type InsightData } from "@/components/InsightCard";
import type { DiffHighlightRecord } from "@/lib/db/types";

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

export function Dashboard() {
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [selectedGenreId, setSelectedGenreId] = useState<string | null>(null);

  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [loadedGenreId, setLoadedGenreId] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightData[]>([]);

  const [selectedItemCode, setSelectedItemCode] = useState<string | null>(null);
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
    if (!selectedGenreId || !selectedItemCode) return;
    const cacheKey = `${selectedGenreId}:${selectedItemCode}`;
    if (fetchedSeriesKeys.current.has(cacheKey)) return;
    fetchedSeriesKeys.current.add(cacheKey);

    let cancelled = false;
    (async () => {
      const data = await safeFetchJson<{ series: TimeSeriesPoint[] }>(
        `/api/rankings?genreId=${encodeURIComponent(selectedGenreId)}&itemCode=${encodeURIComponent(selectedItemCode)}`,
        { series: [] },
      );
      if (cancelled) return;
      setSeriesCache((prev) => ({ ...prev, [cacheKey]: data.series }));
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedItemCode, selectedGenreId]);

  function handleSelectGenre(genreId: string) {
    setSelectedGenreId(genreId);
    setSelectedItemCode(null);
  }

  // 同じ商品をもう一度選ぶと選択解除する
  function handleSelectItem(itemCode: string) {
    setSelectedItemCode((current) => (current === itemCode ? null : itemCode));
  }

  // 直近の収集回で検知された変動 (新規ランクイン・順位急変・価格変動) をitemCode別に引けるようにする。
  // 過去のインサイト分の変動は現在の順位表とは対応しないため、最新1件のみを使う。
  const highlightByItemCode = useMemo(() => {
    const map: Record<string, DiffHighlightRecord> = {};
    for (const highlight of insights[0]?.highlights ?? []) {
      map[highlight.itemCode] = highlight;
    }
    return map;
  }, [insights]);

  const chartItem: ChartItem | null = (() => {
    if (!selectedItemCode || !selectedGenreId) return null;
    const item = leaderboard.find((i) => i.itemCode === selectedItemCode);
    if (!item) return null;
    return {
      itemCode: selectedItemCode,
      itemName: item.itemName,
      points: seriesCache[`${selectedGenreId}:${selectedItemCode}`] ?? [],
    };
  })();

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
              (商品を選択すると順位・価格の推移をグラフ表示)
            </span>
          </h2>
          <RankingLeaderboard
            items={leaderboard}
            selectedItemCode={selectedItemCode}
            highlightFor={(itemCode) => highlightByItemCode[itemCode]}
            onSelect={handleSelectItem}
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

      <RankingChart item={chartItem} onClear={() => setSelectedItemCode(null)} />
    </div>
  );
}
