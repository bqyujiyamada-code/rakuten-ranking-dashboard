import type { RollupNameKeyword, RollupTopItem } from "@/lib/db/types";

// 月次ロールアップに載せる「商品名キーワード頻度」「top30在籍商品」の集計ロジック(純粋関数)。
// 対応42.で追加。季節性・長期トレンド分析の材料を先に溜めておくのが目的。
//
// !!! scripts/compute-monthly-rollup.mjs にこのファイルのロジックを複製している。
//     (スクリプトは src/lib を import しない自己完結の流儀のため。対応28./CLAUDE.md参照)
//     SEASONAL_PHRASES / KEYWORD_STOPWORDS / TOKEN_RE / extractNameKeywords /
//     summariseMonthlySnapshots / ROLLUP_MAX_* を変更したら、必ずスクリプト側も同じに直すこと。

/** nameKeywords に保存する上位語数 */
export const ROLLUP_MAX_NAME_KEYWORDS = 40;
/** topItems に保存する上位商品数 (top30 + 入れ替わりバッファ) */
export const ROLLUP_MAX_TOP_ITEMS = 40;

// 形態素解析は導入しない(依存を増やさない方針)。字種ベースの素朴な抽出 + 明示的な季節
// フレーズ + 最小限のストップワードで構成する経験則であり、厳密な正確さは求めていない。
// 狙いは「前月比・前年同月比で意味のシフトが読める語が残ること」。恒常的なノイズ語
// (ジャンル名など)が多少混じっても、比較時に相殺されるため許容する。
const SEASONAL_PHRASES = [
  "お中元",
  "御中元",
  "お歳暮",
  "御歳暮",
  "母の日",
  "父の日",
  "敬老の日",
  "土用の丑",
  "恵方巻",
  "暑中見舞い",
  "残暑見舞い",
  "お花見",
  "年越し",
  "お正月",
  "お盆",
  "ひな祭り",
  "こどもの日",
  "ハロウィン",
];

// プラットフォーム/販促由来で、季節性シグナルを持たない純粋なノイズ語のみを除外する。
// 「ギフト」「贈答」等の贈答シーズンを示す語は残す(季節性の主要シグナルのため)。
const KEYWORD_STOPWORDS = new Set([
  "送料無料",
  "送料込",
  "ポイント",
  "楽天",
  "クーポン",
  "セール",
  "特価",
  "割引",
  "まとめ買い",
  "在庫",
  "予約",
  "数量限定",
  "期間限定",
  "ランキング",
  "あす楽",
  "配送",
  "のし",
  "ラッピング",
  "ギフ", // 楽天のギフト設定タグ「楽ギフ_のし」等の断片(下の pre-clean で大半は除去済みだが保険)
  "メッセ",
  "宛書",
  // 単位のみの断片(数量表記の名残でノイズになりやすい)
  "kg",
  "ml",
  "cc",
  "mg",
  "mm",
  "cm",
  "oz",
  "lb",
]);

// カタカナ語(2字以上、長音・中黒含む) / 漢字連続(2字以上) / 英数語(2字以上)
const TOKEN_RE = /[ァ-ヶー・]{2,}|[一-鿿々]{2,}|[A-Za-z][A-Za-z0-9]+/g;

/** 1つの商品名から、重複を除いたキーワード集合を返す(純粋関数) */
export function extractNameKeywords(name: string): string[] {
  const found = new Set<string>();
  // 楽天のギフト設定タグ(【楽ギフ_のし】【楽ギフ_のし宛書】【楽ギフ_メッセ入力】等)は
  // 販促・システム由来のノイズなので、トークン化の前に丸ごと落とす。
  let rest = name.replace(/楽ギフ[_＿][^\]】\s]*/g, " ");

  for (const phrase of SEASONAL_PHRASES) {
    if (rest.includes(phrase)) {
      found.add(phrase);
      rest = rest.split(phrase).join(" ");
    }
  }

  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(rest)) !== null) {
    const raw = match[0];
    const term = /[A-Za-z]/.test(raw) ? raw.toLowerCase() : raw;
    if (term.length < 2) continue;
    if (KEYWORD_STOPWORDS.has(term)) continue;
    found.add(term);
  }

  return [...found];
}

export interface MonthlySnapshotRow {
  rank: number;
  itemCode: string;
  itemName: string;
}

/**
 * その月の全収集日ぶんのスナップショット(各日 = top30 の配列)を横断して、
 * キーワード頻度と top30 在籍商品ランキングを集計する。
 */
export function summariseMonthlySnapshots(dailySnapshots: MonthlySnapshotRow[][]): {
  nameKeywords: RollupNameKeyword[];
  topItems: RollupTopItem[];
} {
  const keywordItemCodes = new Map<string, Set<string>>();
  const keywordOccurrences = new Map<string, number>();
  const items = new Map<
    string,
    { itemName: string; daysPresent: number; rankSum: number; bestRank: number }
  >();

  for (const day of dailySnapshots) {
    for (const row of day) {
      if (!row.itemCode) continue;
      const rank = Number(row.rank);

      const existing = items.get(row.itemCode);
      if (existing) {
        existing.daysPresent += 1;
        existing.rankSum += rank;
        existing.bestRank = Math.min(existing.bestRank, rank);
        if (row.itemName) existing.itemName = row.itemName;
      } else {
        items.set(row.itemCode, {
          itemName: row.itemName,
          daysPresent: 1,
          rankSum: rank,
          bestRank: rank,
        });
      }

      for (const term of extractNameKeywords(row.itemName)) {
        keywordOccurrences.set(term, (keywordOccurrences.get(term) ?? 0) + 1);
        let codes = keywordItemCodes.get(term);
        if (!codes) {
          codes = new Set<string>();
          keywordItemCodes.set(term, codes);
        }
        codes.add(row.itemCode);
      }
    }
  }

  const nameKeywords: RollupNameKeyword[] = [...keywordOccurrences.entries()]
    .map(([term, occurrences]) => ({
      term,
      occurrences,
      itemCount: keywordItemCodes.get(term)?.size ?? 0,
    }))
    .sort(
      (a, b) =>
        b.itemCount - a.itemCount ||
        b.occurrences - a.occurrences ||
        a.term.localeCompare(b.term),
    )
    .slice(0, ROLLUP_MAX_NAME_KEYWORDS);

  const topItems: RollupTopItem[] = [...items.entries()]
    .map(([itemCode, v]) => ({
      itemCode,
      itemName: v.itemName,
      daysPresent: v.daysPresent,
      avgRank: Math.round((v.rankSum / v.daysPresent) * 10) / 10,
      bestRank: v.bestRank,
    }))
    .sort(
      (a, b) =>
        b.daysPresent - a.daysPresent ||
        a.avgRank - b.avgRank ||
        a.itemCode.localeCompare(b.itemCode),
    )
    .slice(0, ROLLUP_MAX_TOP_ITEMS);

  return { nameKeywords, topItems };
}
