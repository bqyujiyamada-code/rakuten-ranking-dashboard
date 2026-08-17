import { test } from "node:test";
import assert from "node:assert/strict";
import { stripMarkdown } from "./markdown.ts";

test("太字記法(**text**)を取り除く", () => {
  assert.equal(
    stripMarkdown("* **令和8年熊本地震から1週間、防災・支援物資の需要増**"),
    "・令和8年熊本地震から1週間、防災・支援物資の需要増",
  );
});

test("箇条書き記号(*/-/+)を「・」に変換する", () => {
  assert.equal(stripMarkdown("- 項目A\n* 項目B\n+ 項目C"), "・項目A\n・項目B\n・項目C");
});

test("3行以上の連続改行を2行にまとめる", () => {
  assert.equal(stripMarkdown("行1\n\n\n\n行2"), "行1\n\n行2");
});

test("Markdown記法が無ければそのまま(前後の空白のみ除去)", () => {
  assert.equal(stripMarkdown("  普通の文章です  "), "普通の文章です");
});
