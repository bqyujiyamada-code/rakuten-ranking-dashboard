import { test } from "node:test";
import assert from "node:assert/strict";
import { DIFF_THRESHOLDS, detectDiffHighlights, selectHighlightsForGemini } from "./diff.ts";
import type { DiffHighlightRecord, DiffHighlightType, RankingSnapshotItem } from "@/lib/db/types";
import type { RankingItem } from "@/lib/rakuten/types";

function current(overrides: Partial<RankingItem> & { itemCode: string; rank: number }): RankingItem {
  return {
    genreId: "100283",
    itemName: `商品${overrides.itemCode}`,
    price: 1000,
    itemUrl: "https://example.com",
    ...overrides,
  };
}

function previous(
  overrides: Partial<RankingSnapshotItem> & { itemCode: string; rank: number },
): RankingSnapshotItem {
  return {
    PK: `GENRE#100283#ITEM#${overrides.itemCode}`,
    SK: "TS#2026-08-01T00:00:00.000Z",
    entityType: "RANKING_ITEM",
    genreId: "100283",
    itemName: `商品${overrides.itemCode}`,
    price: 1000,
    itemUrl: "https://example.com",
    capturedAt: "2026-08-01T00:00:00.000Z",
    GSI1PK: "GENRE#100283",
    GSI1SK: "TS#2026-08-01T00:00:00.000Z#RANK#0001",
    ...overrides,
  };
}

test("detectDiffHighlights: 閾値内の新規ランクインのみNEW_ENTRYになる", () => {
  const currents = [
    current({ itemCode: "a", rank: DIFF_THRESHOLDS.newEntryMaxRank }),
    current({ itemCode: "b", rank: DIFF_THRESHOLDS.newEntryMaxRank + 1 }),
  ];
  const highlights = detectDiffHighlights(currents, []);
  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].itemCode, "a");
  assert.equal(highlights[0].type, "NEW_ENTRY");
});

test("detectDiffHighlights: 順位上昇/下降を閾値通りに検知する", () => {
  const surgeDelta = DIFF_THRESHOLDS.rankSurgeMinDelta;
  const dropDelta = DIFF_THRESHOLDS.rankDropMinDelta;
  const currents = [
    current({ itemCode: "surge", rank: 20 - surgeDelta }),
    current({ itemCode: "drop", rank: 5 + dropDelta }),
    current({ itemCode: "flat", rank: 15 }),
  ];
  const previousItems = [
    previous({ itemCode: "surge", rank: 20 }),
    previous({ itemCode: "drop", rank: 5 }),
    previous({ itemCode: "flat", rank: 14 }),
  ];
  const highlights = detectDiffHighlights(currents, previousItems);
  const byCode = Object.fromEntries(highlights.map((h) => [h.itemCode, h.type]));
  assert.equal(byCode.surge, "RANK_SURGE");
  assert.equal(byCode.drop, "RANK_DROP");
  assert.equal(byCode.flat, undefined);
});

test("detectDiffHighlights: 値上げ/値下げを閾値通りに検知する(ゼロ除算は無視)", () => {
  const currents = [
    current({ itemCode: "cheaper", rank: 1, price: 900 }), // -10%
    current({ itemCode: "pricier", rank: 2, price: 1150 }), // +15%
    current({ itemCode: "sameish", rank: 3, price: 950 }), // -5%, 閾値未満
    current({ itemCode: "freebie", rank: 4, price: 500 }),
  ];
  const previousItems = [
    previous({ itemCode: "cheaper", rank: 1, price: 1000 }),
    previous({ itemCode: "pricier", rank: 2, price: 1000 }),
    previous({ itemCode: "sameish", rank: 3, price: 1000 }),
    previous({ itemCode: "freebie", rank: 4, price: 0 }), // 前回価格0 → 除算回避で無視される
  ];
  const highlights = detectDiffHighlights(currents, previousItems);
  const byCode = Object.fromEntries(highlights.map((h) => [h.itemCode, h.type]));
  assert.equal(byCode.cheaper, "PRICE_DROP");
  assert.equal(byCode.pricier, "PRICE_UP");
  assert.equal(byCode.sameish, undefined);
  assert.equal(byCode.freebie, undefined);
});

test("detectDiffHighlights: 件数の上限を設けない(8件超でも全件返す)", () => {
  const currents = Array.from({ length: 12 }, (_, i) => current({ itemCode: `n${i}`, rank: i + 1 }));
  const highlights = detectDiffHighlights(currents, []);
  assert.equal(highlights.length, 10); // rank 11,12はnewEntryMaxRank(10)超で対象外
});

test("selectHighlightsForGemini: 他タイプの候補が十分あれば新規ランクインは4件までに抑える", () => {
  const newEntries: DiffHighlightRecord[] = Array.from({ length: 10 }, (_, i) => ({
    type: "NEW_ENTRY" as DiffHighlightType,
    itemCode: `new${i}`,
    itemName: `新規${i}`,
    currentRank: i + 1,
    detail: "",
  }));
  const others: DiffHighlightRecord[] = Array.from({ length: 6 }, (_, i) => ({
    type: "RANK_SURGE" as DiffHighlightType,
    itemCode: `surge${i}`,
    itemName: `上昇${i}`,
    currentRank: 2,
    previousRank: 10,
    detail: "",
  }));

  const selected = selectHighlightsForGemini([...newEntries, ...others]);
  assert.equal(selected.length, 8);
  const newEntryCount = selected.filter((h) => h.type === "NEW_ENTRY").length;
  assert.equal(newEntryCount, 4, `他タイプの候補が十分あるので新規ランクインは4件のはず (実際: ${newEntryCount})`);
  assert.equal(selected.filter((h) => h.type === "RANK_SURGE").length, 4);
});

test("selectHighlightsForGemini: 他タイプの候補が少ない場合は空き枠を新規ランクインで埋める(4件上限を超える)", () => {
  const newEntries: DiffHighlightRecord[] = Array.from({ length: 10 }, (_, i) => ({
    type: "NEW_ENTRY" as DiffHighlightType,
    itemCode: `new${i}`,
    itemName: `新規${i}`,
    currentRank: i + 1,
    detail: "",
  }));
  const others: DiffHighlightRecord[] = [
    { type: "RANK_SURGE", itemCode: "s1", itemName: "上昇", currentRank: 2, previousRank: 10, detail: "" },
    { type: "PRICE_DROP", itemCode: "p1", itemName: "値下げ", detail: "" },
  ];

  const selected = selectHighlightsForGemini([...newEntries, ...others]);
  assert.equal(selected.length, 8);
  const newEntryCount = selected.filter((h) => h.type === "NEW_ENTRY").length;
  assert.equal(newEntryCount, 6, `空き枠2件が新規ランクインで埋まり4+2=6件になるはず (実際: ${newEntryCount})`);
  assert.ok(selected.some((h) => h.type === "RANK_SURGE"));
  assert.ok(selected.some((h) => h.type === "PRICE_DROP"));
});

test("selectHighlightsForGemini: 他タイプが足りない場合は新規ランクインで空き枠を埋める", () => {
  const newEntries: DiffHighlightRecord[] = Array.from({ length: 10 }, (_, i) => ({
    type: "NEW_ENTRY" as DiffHighlightType,
    itemCode: `new${i}`,
    itemName: `新規${i}`,
    currentRank: i + 1,
    detail: "",
  }));
  const selected = selectHighlightsForGemini(newEntries);
  assert.equal(selected.length, 8);
  assert.ok(selected.every((h) => h.type === "NEW_ENTRY"));
});
