import { test } from "node:test";
import assert from "node:assert/strict";
import { movementLabel } from "./highlight.ts";
import type { DiffHighlightRecord } from "@/lib/db/types";

function record(overrides: Partial<DiffHighlightRecord>): DiffHighlightRecord {
  return {
    type: "NEW_ENTRY",
    itemCode: "shop:1",
    itemName: "テスト商品",
    detail: "",
    ...overrides,
  };
}

test("NEW_ENTRY: 現在順位を表示", () => {
  assert.equal(movementLabel(record({ type: "NEW_ENTRY", currentRank: 3 })), "3位");
});

test("RANK_SURGE/RANK_DROP: 「前回→今回位」形式", () => {
  assert.equal(
    movementLabel(record({ type: "RANK_SURGE", previousRank: 12, currentRank: 3 })),
    "12→3位",
  );
  assert.equal(
    movementLabel(record({ type: "RANK_DROP", previousRank: 3, currentRank: 20 })),
    "3→20位",
  );
});

test("PRICE_UP/PRICE_DROP: 符号付きパーセント表示", () => {
  assert.equal(
    movementLabel(record({ type: "PRICE_UP", previousPrice: 1000, currentPrice: 1200 })),
    "+20%",
  );
  assert.equal(
    movementLabel(record({ type: "PRICE_DROP", previousPrice: 1000, currentPrice: 800 })),
    "-20%",
  );
});

test("価格情報が欠けている場合はnull", () => {
  assert.equal(movementLabel(record({ type: "PRICE_UP", currentPrice: 1200 })), null);
});

test("previousPriceが0以下の場合はnull(ゼロ除算回避)", () => {
  assert.equal(
    movementLabel(record({ type: "PRICE_DROP", previousPrice: 0, currentPrice: 500 })),
    null,
  );
});
