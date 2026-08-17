import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toJstDateString,
  addDaysJst,
  currentJstMonth,
  previousJstMonth,
  formatJstDateLabel,
} from "./jst.ts";

test("toJstDateString: UTC深夜はJSTでは翌日になる", () => {
  // 2026-07-29T22:00:00Z = 2026-07-30T07:00:00+09:00
  assert.equal(toJstDateString(new Date("2026-07-29T22:00:00Z")), "2026-07-30");
});

test("addDaysJst: 月またぎでも正しく加算できる", () => {
  assert.equal(addDaysJst("2026-07-31", 1), "2026-08-01");
  assert.equal(addDaysJst("2026-08-01", -1), "2026-07-31");
});

test("previousJstMonth: 年またぎ", () => {
  assert.equal(previousJstMonth("2026-01"), "2025-12");
  assert.equal(previousJstMonth("2026-08"), "2026-07");
});

test("currentJstMonth: YYYY-MM形式を返す", () => {
  assert.match(currentJstMonth(), /^\d{4}-\d{2}$/);
});

test("formatJstDateLabel: 日本語ラベルに整形する", () => {
  assert.equal(formatJstDateLabel("2026-08-06"), "2026年8月6日木曜日");
});
