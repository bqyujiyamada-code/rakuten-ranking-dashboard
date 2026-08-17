import { test } from "node:test";
import assert from "node:assert/strict";
import { displayItemName } from "./itemName.ts";

test("冒頭の販促文言(締め記号あり)を取り除く", () => {
  assert.equal(
    displayItemName("今夜23:59までポイント10倍！お試し送料無料2,490円～ 井村屋 えいようかん"),
    "井村屋 えいようかん",
  );
});

test("販促文言が無ければ変更しない", () => {
  const name = "井村屋 えいようかん(5本入×8箱セット(1本 60g))【井村屋】[備蓄 防災 長期保存]";
  assert.equal(displayItemName(name), name);
});

test("通常の商品名はそのまま返す", () => {
  assert.equal(displayItemName("普通の商品名だけ"), "普通の商品名だけ");
});

test("結果が短すぎる場合は元の文字列にフォールバックする", () => {
  // MIN_RESULT_LENGTH(4文字)未満まで削れてしまうケース
  assert.equal(displayItemName("！！！"), "！！！");
});
