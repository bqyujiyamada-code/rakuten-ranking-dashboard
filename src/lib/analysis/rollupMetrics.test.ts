import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractNameKeywords,
  summariseMonthlySnapshots,
  type MonthlySnapshotRow,
} from "./rollupMetrics.ts";

test("extractNameKeywords: 季節フレーズ・カタカナ語・漢字語を拾い、ノイズ語を除外する", () => {
  const terms = extractNameKeywords(
    "【お中元】送料無料 ポイント10倍 スターバックス コーヒー ギフト 詰め合わせ",
  );
  assert.ok(terms.includes("お中元"));
  assert.ok(terms.includes("スターバックス"));
  assert.ok(terms.includes("ギフト"));
  assert.ok(!terms.includes("送料無料"));
  assert.ok(!terms.includes("ポイント"));
  assert.ok(!terms.includes("楽天"));
});

test("extractNameKeywords: 1字の漢字・数字始まりの断片は拾わない", () => {
  const terms = extractNameKeywords("米 5kg 2026年 詰合せ");
  assert.ok(!terms.includes("米"));
  assert.ok(!terms.includes("5kg"));
  assert.ok(!terms.includes("2026"));
  assert.ok(terms.includes("詰合せ") || terms.includes("詰合"));
});

test("summariseMonthlySnapshots: 在籍日数と平均順位を集計し降順で返す", () => {
  const days: MonthlySnapshotRow[][] = [
    [
      { rank: 1, itemCode: "a", itemName: "定番 コーヒー" },
      { rank: 5, itemCode: "b", itemName: "お中元 ギフト" },
    ],
    [
      { rank: 2, itemCode: "a", itemName: "定番 コーヒー" },
      { rank: 9, itemCode: "c", itemName: "新顔 紅茶" },
    ],
    [{ rank: 3, itemCode: "a", itemName: "定番 コーヒー" }],
  ];

  const { topItems, nameKeywords } = summariseMonthlySnapshots(days);

  assert.equal(topItems[0].itemCode, "a");
  assert.equal(topItems[0].daysPresent, 3);
  assert.equal(topItems[0].avgRank, 2);
  assert.equal(topItems[0].bestRank, 1);

  const coffee = nameKeywords.find((k) => k.term === "コーヒー");
  assert.equal(coffee?.itemCount, 1);
  assert.equal(coffee?.occurrences, 3);
});

test("summariseMonthlySnapshots: 空入力でも落ちない", () => {
  const { topItems, nameKeywords } = summariseMonthlySnapshots([]);
  assert.deepEqual(topItems, []);
  assert.deepEqual(nameKeywords, []);
});
