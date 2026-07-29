export interface GenreDefinition {
  genreId: string;
  name: string;
}

/**
 * 定期収集の対象とする「食品・ドリンク関連の中ジャンル (ジャンルレベル2)」マスタ。
 * genreId は楽天市場ジャンル検索API (IchibaGenre/Search) で事前に確認・更新すること。
 * ここに挙げているIDは公開情報を参考にした代表例であり、実運用前に必ず実在確認を行う。
 */
export const TARGET_GENRES: GenreDefinition[] = [
  // 食品
  { genreId: "100228", name: "精肉・肉加工品" },
  { genreId: "100236", name: "魚介類・水産加工品" },
  { genreId: "110472", name: "米・雑穀" },
  { genreId: "100293", name: "パン・ジャム・シリアル" },
  { genreId: "100256", name: "麺類" },
  { genreId: "100300", name: "調味料" },
  { genreId: "100262", name: "チーズ・乳製品" },
  // スイーツ・お菓子
  { genreId: "100283", name: "洋菓子" },
  { genreId: "509708", name: "和菓子" },
  { genreId: "201136", name: "チョコレート" },
  { genreId: "201150", name: "アイスクリーム・シャーベット" },
  // ドリンク
  { genreId: "201351", name: "水・炭酸水" },
  { genreId: "100356", name: "コーヒー" },
  { genreId: "100324", name: "ビール・発泡酒" },
  { genreId: "100317", name: "ワイン" },
  { genreId: "100337", name: "日本酒" },
];

export function findGenreById(genreId: string): GenreDefinition | undefined {
  return TARGET_GENRES.find((genre) => genre.genreId === genreId);
}
