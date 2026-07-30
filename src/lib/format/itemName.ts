// 楽天の商品名は「今夜23:59までポイント10倍！」「【送料無料】」のような販促・SEO文言が
// 冒頭に大量に埋め込まれることが多く、UI側でtruncate表示すると実際の商品名が見えない。
// この関数は表示専用の見出し文字列を作るためのもので、元データ(itemName)は一切変更しない。
// あくまで正規表現ベースの経験則であり完全ではない(例: 販促文言の直後に本来の商品名が来る
// パターンには強いが、稀に本文と誤認して削りすぎる/削り足りないケースがある)。
// 呼び出し側は必ずhoverのtitle等で元のitemNameも参照できるようにすること。

const BRACKET_PAIRS: readonly (readonly [string, string])[] = [
  ["【", "】"],
  ["［", "］"],
  ["[", "]"],
  ["（", "）"],
  ["(", ")"],
];

// これらの語を含む冒頭部分は販促文言とみなす。締めの記号(！/!/～/⇒/→/／/★)の
// いずれかが現れた直後までを1セグメントとして切り落とす。
const PROMO_KEYWORDS_RE =
  /(まで|ポイント\d*倍|P\d+倍|クーポン|送料無料|円OFF|[%％]OFF|在庫処分|限定|セール|最安値|お試し|値下げ|値上げ)/;
const TERMINATOR_RE = /[！!～⇒→／★]/;
const MAX_PROMO_SEGMENT_LENGTH = 40;
// キーワードがこの文字数より後ろに現れた場合は「先頭が販促文言」とは判断しない
// (本来の商品名の後半にたまたま送料無料等の語が出てくるだけのケースを誤って削らないため)
const KEYWORD_MAX_START = 20;
const MAX_STRIP_ITERATIONS = 6;
const MIN_RESULT_LENGTH = 4;

function stripLeadingBracket(name: string): string | null {
  for (const [open, close] of BRACKET_PAIRS) {
    if (!name.startsWith(open)) continue;
    const closeIndex = name.indexOf(close, open.length);
    if (closeIndex === -1) continue;
    return name.slice(closeIndex + close.length);
  }
  return null;
}

function stripLeadingPromoSegment(name: string): string | null {
  const window = name.slice(0, MAX_PROMO_SEGMENT_LENGTH);
  const keywordMatch = PROMO_KEYWORDS_RE.exec(window);
  if (!keywordMatch || keywordMatch.index > KEYWORD_MAX_START) return null;

  const searchFrom = keywordMatch.index + keywordMatch[0].length;
  const terminatorMatch = window.slice(searchFrom).match(TERMINATOR_RE);
  if (!terminatorMatch || terminatorMatch.index === undefined) return null;

  return name.slice(searchFrom + terminatorMatch.index + 1);
}

/** 表示用に商品名冒頭の販促文言・装飾ブラケットを取り除く (元データは変更しない) */
export function displayItemName(name: string): string {
  let result = name;
  for (let i = 0; i < MAX_STRIP_ITERATIONS; i += 1) {
    const trimmed = result.trimStart();
    const afterBracket = stripLeadingBracket(trimmed);
    if (afterBracket !== null) {
      result = afterBracket;
      continue;
    }
    const afterPromo = stripLeadingPromoSegment(trimmed);
    if (afterPromo !== null) {
      result = afterPromo;
      continue;
    }
    result = trimmed;
    break;
  }

  result = result.replace(/^[！!～⇒→、,。.\s／\/＼\\]+/, "").trim();
  return result.length >= MIN_RESULT_LENGTH ? result : name.trim();
}
