"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GenreSelector, type GenreOption } from "@/components/GenreSelector";
import { RankingLeaderboard, type LeaderboardItem } from "@/components/RankingLeaderboard";
import { RankingChart, type ChartItem } from "@/components/RankingChart";
import {
  InsightCard,
  type InsightData,
  type DailyContextWeather,
  type DailyContextTrend,
} from "@/components/InsightCard";
import { HistoryDatePicker, type DateOption } from "@/components/HistoryDatePicker";
import type { DiffHighlightRecord } from "@/lib/db/types";

interface TimeSeriesPoint {
  timestamp: string;
  rank: number;
  price: number;
}

interface DailyContextData {
  date: string | null;
  causalDate: string | null;
  weather: DailyContextWeather | null;
  trend: DailyContextTrend | null;
}

const EMPTY_DAILY_CONTEXT: DailyContextData = {
  date: null,
  causalDate: null,
  weather: null,
  trend: null,
};

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

  const [historyDates, setHistoryDates] = useState<DateOption[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightData[]>([]);
  const [dailyContext, setDailyContext] = useState<DailyContextData>(EMPTY_DAILY_CONTEXT);

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

  // バックナンバー閲覧用に、収集済みの日付一覧を初期取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await safeFetchJson<{ dates: DateOption[] }>("/api/dates", {
        dates: [],
      });
      if (cancelled) return;
      setHistoryDates(data.dates);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 選択ジャンル・選択日の順位表 + AIインサイト取得
  useEffect(() => {
    if (!selectedGenreId) return;
    let cancelled = false;

    (async () => {
      const dateQuery = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : "";
      // 表示日ピッカーで過去日にも遡れるため、インサイトは常に表示中の日の1件だけを見せれば良い
      const insightQuery = selectedDate ? dateQuery : "&limit=1";
      const [rankData, insightData] = await Promise.all([
        safeFetchJson<{ items: LeaderboardItem[] }>(
          `/api/rankings?genreId=${encodeURIComponent(selectedGenreId)}${dateQuery}`,
          { items: [] },
        ),
        safeFetchJson<{ insights: InsightData[] }>(
          `/api/insights?genreId=${encodeURIComponent(selectedGenreId)}${insightQuery}`,
          { insights: [] },
        ),
      ]);
      if (cancelled) return;
      setLeaderboard(rankData.items);
      setInsights(insightData.insights);
      setLoadedKey(`${selectedGenreId}:${selectedDate ?? "latest"}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGenreId, selectedDate]);

  // 選択日の判断材料(前日の気象・世間のトレンド)取得。ジャンルには依存しない
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dateQuery = selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : "";
      const data = await safeFetchJson<DailyContextData>(
        `/api/daily-context${dateQuery}`,
        EMPTY_DAILY_CONTEXT,
      );
      if (cancelled) return;
      setDailyContext(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const isLeaderboardLoading =
    selectedGenreId !== null &&
    loadedKey !== `${selectedGenreId}:${selectedDate ?? "latest"}`;

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

  function handleSelectDate(date: string | null) {
    setSelectedDate(date);
    setSelectedItemCode(null);
  }

  // 同じ商品をもう一度選ぶと選択解除する
  function handleSelectItem(itemCode: string) {
    setSelectedItemCode((current) => (current === itemCode ? null : itemCode));
  }

  // 選択日(=表示中の順位表)に対応する収集回で検知された変動 (新規ランクイン・順位急変・
  // 価格変動) をitemCode別に引けるようにする。leaderboardとinsightsは常に同じ日付で
  // 取得しているため、latest表示時も過去日付表示時も対応関係は保たれる。
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
          定期収集したランキングの推移と、気象・世間のトレンドを踏まえたAI分析を確認できます。
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <GenreSelector
          genres={genres}
          selectedGenreId={selectedGenreId}
          onSelect={handleSelectGenre}
        />
        <HistoryDatePicker
          dates={historyDates}
          selectedDate={selectedDate}
          onSelect={handleSelectDate}
        />
      </div>

      <InsightCard
        insight={insights[0] ?? null}
        genreName={selectedGenreName}
        weather={dailyContext.weather}
        trend={dailyContext.trend}
        causalDate={dailyContext.causalDate}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
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

        <div className="min-w-0 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">価格・順位の推移</h2>
          <RankingChart item={chartItem} onClear={() => setSelectedItemCode(null)} />
        </div>
      </div>
    </div>
  );
}
