import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCronFailureMessage,
  buildRetryOutcomeMessage,
  buildMonthlyRollupFailureMessage,
} from "./cronAlert.ts";
import type {
  DailyContext,
  GenreCollectionResult,
  RetryOutcome,
} from "@/lib/collectAndAnalyze";
import type { MonthlyRollupMonthResult } from "@/lib/analysis/monthlyRollup";

const OK_CONTEXT: DailyContext = {
  weather: { date: "2026-08-01", tempMaxC: 30, tempMinC: 25, precipitationMm: 0, weatherLabel: "晴れ" },
  trend: { date: "2026-08-01", summaryText: "サンプル" },
};

function genreResult(overrides: Partial<GenreCollectionResult>): GenreCollectionResult {
  return {
    genreId: "100283",
    genreName: "洋菓子",
    itemCount: 30,
    highlightCount: 0,
    aiAnalysisGenerated: true,
    ...overrides,
  };
}

test("buildCronFailureMessage: 全て成功していればnull(成功時は静かに)", () => {
  const results = [genreResult({}), genreResult({ genreId: "509708", genreName: "和菓子" })];
  assert.equal(buildCronFailureMessage(results, OK_CONTEXT, "2026-08-01"), null);
});

test("buildCronFailureMessage: highlightCount=0でaiAnalysisGenerated=falseは正常系(変動なし)なので失敗扱いしない", () => {
  const results = [genreResult({ highlightCount: 0, aiAnalysisGenerated: false })];
  assert.equal(buildCronFailureMessage(results, OK_CONTEXT, "2026-08-01"), null);
});

test("buildCronFailureMessage: ランキング取得自体の失敗を検知する", () => {
  const results = [genreResult({ error: "楽天API 503" })];
  const message = buildCronFailureMessage(results, OK_CONTEXT, "2026-08-01");
  assert.ok(message?.includes("ランキング取得/保存に失敗"));
  assert.ok(message?.includes("自動リトライ対象外"));
});

test("buildCronFailureMessage: ハイライト検知後のAI分析失敗を検知する", () => {
  const results = [genreResult({ highlightCount: 5, aiAnalysisGenerated: false })];
  const message = buildCronFailureMessage(results, OK_CONTEXT, "2026-08-01");
  assert.ok(message?.includes("AI分析に失敗"));
  assert.ok(message?.includes("自動リトライされます"));
});

test("buildCronFailureMessage: 気象/トレンド取得失敗も報告する", () => {
  const results = [genreResult({})];
  const message = buildCronFailureMessage(results, { weather: null, trend: null }, "2026-08-01");
  assert.ok(message?.includes("気象データ"));
  assert.ok(message?.includes("トレンド要約"));
});

test("buildRetryOutcomeMessage: 全て解決していればnull", () => {
  const outcome: RetryOutcome = {
    today: "2026-08-01",
    weather: OK_CONTEXT.weather,
    trend: OK_CONTEXT.trend,
    results: [{ genreId: "100283", genreName: "洋菓子", outcome: "skipped-already-ok" }],
  };
  assert.equal(buildRetryOutcomeMessage(outcome), null);
});

test("buildRetryOutcomeMessage: リトライ後も残る失敗を報告する", () => {
  const outcome: RetryOutcome = {
    today: "2026-08-01",
    weather: null,
    trend: OK_CONTEXT.trend,
    results: [
      { genreId: "100283", genreName: "洋菓子", outcome: "failed", error: "504" },
      { genreId: "509708", genreName: "和菓子", outcome: "skipped-no-snapshot" },
    ],
  };
  const message = buildRetryOutcomeMessage(outcome);
  assert.ok(message?.includes("自動リトライでもAI分析に失敗"));
  assert.ok(message?.includes("ランキング取得自体が失敗"));
  assert.ok(message?.includes("気象データ"));
});

test("buildMonthlyRollupFailureMessage: 全ジャンル成功ならnull", () => {
  const monthResults: MonthlyRollupMonthResult[] = [
    { month: "2026-08", daysCollected: 17, genres: [{ genreId: "100283", outcome: "saved" }] },
  ];
  assert.equal(buildMonthlyRollupFailureMessage(monthResults), null);
});

test("buildMonthlyRollupFailureMessage: 失敗したジャンルを報告する", () => {
  const monthResults: MonthlyRollupMonthResult[] = [
    {
      month: "2026-08",
      daysCollected: 17,
      genres: [
        { genreId: "100283", outcome: "saved" },
        { genreId: "509708", outcome: "failed", error: "AccessDeniedException" },
      ],
    },
  ];
  const message = buildMonthlyRollupFailureMessage(monthResults);
  assert.ok(message?.includes("509708"));
  assert.ok(message?.includes("AccessDeniedException"));
  assert.ok(!message?.includes("100283:"));
});
