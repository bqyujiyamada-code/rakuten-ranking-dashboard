import type { DiffHighlightRecord, RankingSnapshotItem } from "@/lib/db/types";
import type { RankingItem } from "@/lib/rakuten/types";

/** 差分をハイライト化する際の閾値。運用しながら調整する想定 */
export const DIFF_THRESHOLDS = {
  newEntryMaxRank: 10,
  rankSurgeMinDelta: 5,
  rankDropMinDelta: 10,
  priceDropMinPct: 0.1,
  priceUpMinPct: 0.15,
} as const;

const MAX_HIGHLIGHTS = 8;
// 楽天のリアルタイムランキングは母数が小さいジャンルほど日次の総入れ替わりが激しく、
// 新規ランクインだけで8枠が埋まりやすい。ランク上昇/下降・価格変動の枠を確保するため、
// 新規ランクインは最大でもこの件数までに抑え、残り枠を他の変動タイプに割り当てる。
const MAX_NEW_ENTRY_HIGHLIGHTS = 4;

/**
 * 今回取得したランキングと前回スナップショットを比較し、
 * Geminiに渡す価値のある「重要な変化」のみを抽出する。
 */
export function detectDiffHighlights(
  currentItems: RankingItem[],
  previousItems: RankingSnapshotItem[],
): DiffHighlightRecord[] {
  const previousByCode = new Map(
    previousItems.map((item) => [item.itemCode, item] as const),
  );
  const highlights: DiffHighlightRecord[] = [];

  for (const current of currentItems) {
    const previous = previousByCode.get(current.itemCode);

    if (!previous) {
      if (current.rank <= DIFF_THRESHOLDS.newEntryMaxRank) {
        highlights.push({
          type: "NEW_ENTRY",
          itemCode: current.itemCode,
          itemName: current.itemName,
          currentRank: current.rank,
          currentPrice: current.price,
          detail: `${current.rank}位に新規ランクイン`,
        });
      }
      continue;
    }

    const rankDelta = previous.rank - current.rank; // 正の値 = 順位上昇

    if (rankDelta >= DIFF_THRESHOLDS.rankSurgeMinDelta) {
      highlights.push({
        type: "RANK_SURGE",
        itemCode: current.itemCode,
        itemName: current.itemName,
        currentRank: current.rank,
        previousRank: previous.rank,
        detail: `${previous.rank}位 → ${current.rank}位 (${rankDelta}ランク上昇)`,
      });
    } else if (-rankDelta >= DIFF_THRESHOLDS.rankDropMinDelta) {
      highlights.push({
        type: "RANK_DROP",
        itemCode: current.itemCode,
        itemName: current.itemName,
        currentRank: current.rank,
        previousRank: previous.rank,
        detail: `${previous.rank}位 → ${current.rank}位 (${-rankDelta}ランク下降)`,
      });
    }

    if (previous.price > 0) {
      const priceChangePct = (current.price - previous.price) / previous.price;

      if (priceChangePct <= -DIFF_THRESHOLDS.priceDropMinPct) {
        highlights.push({
          type: "PRICE_DROP",
          itemCode: current.itemCode,
          itemName: current.itemName,
          currentPrice: current.price,
          previousPrice: previous.price,
          detail: `価格 ${previous.price}円 → ${current.price}円 (${Math.round(priceChangePct * 100)}%)`,
        });
      } else if (priceChangePct >= DIFF_THRESHOLDS.priceUpMinPct) {
        highlights.push({
          type: "PRICE_UP",
          itemCode: current.itemCode,
          itemName: current.itemName,
          currentPrice: current.price,
          previousPrice: previous.price,
          detail: `価格 ${previous.price}円 → ${current.price}円 (+${Math.round(priceChangePct * 100)}%)`,
        });
      }
    }
  }

  return selectDiverseHighlights(highlights);
}

/**
 * 新規ランクインが件数で他タイプを圧倒しないよう、新規ランクインの採用数に上限を設けた上で
 * MAX_HIGHLIGHTS件を選ぶ。他タイプの候補が少ない場合は余った枠を新規ランクインで埋める。
 */
function selectDiverseHighlights(
  highlights: DiffHighlightRecord[],
): DiffHighlightRecord[] {
  const sorted = sortBySignificance(highlights);
  const newEntries = sorted.filter((h) => h.type === "NEW_ENTRY");
  const others = sorted.filter((h) => h.type !== "NEW_ENTRY");

  const selectedNewEntries = newEntries.slice(0, MAX_NEW_ENTRY_HIGHLIGHTS);
  const selectedOthers = others.slice(0, MAX_HIGHLIGHTS - selectedNewEntries.length);

  const leftoverSlots =
    MAX_HIGHLIGHTS - selectedNewEntries.length - selectedOthers.length;
  const extraNewEntries =
    leftoverSlots > 0
      ? newEntries.slice(
          selectedNewEntries.length,
          selectedNewEntries.length + leftoverSlots,
        )
      : [];

  return sortBySignificance([
    ...selectedNewEntries,
    ...selectedOthers,
    ...extraNewEntries,
  ]);
}

function significanceWeight(highlight: DiffHighlightRecord): number {
  switch (highlight.type) {
    case "NEW_ENTRY":
      return 1000 - (highlight.currentRank ?? 0);
    case "RANK_SURGE":
      return 500 + ((highlight.previousRank ?? 0) - (highlight.currentRank ?? 0));
    case "RANK_DROP":
      return 200 + ((highlight.currentRank ?? 0) - (highlight.previousRank ?? 0));
    case "PRICE_DROP":
      return 100;
    case "PRICE_UP":
      return 50;
    default:
      return 0;
  }
}

function sortBySignificance(
  highlights: DiffHighlightRecord[],
): DiffHighlightRecord[] {
  return [...highlights].sort(
    (a, b) => significanceWeight(b) - significanceWeight(a),
  );
}
