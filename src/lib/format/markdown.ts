/**
 * Geminiのテキスト出力(箇条書き依頼時など)に紛れ込むMarkdown記法を、
 * プレーンテキスト表示用に取り除く。UI側はMarkdownパーサーを持たず
 * `whitespace-pre-line`でそのまま表示するため、`**太字**`やアスタリスクの
 * 箇条書き記号がそのまま画面に出てしまう対策。プロンプト側で「Markdownを
 * 使わない」よう指示していても確実ではないため、保存前にここで正規化する。
 */
export function stripMarkdown(text: string): string {
  const withoutBold = text.replace(/\*\*(.+?)\*\*/g, "$1");

  return withoutBold
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return "";
      const bulletMatch = trimmed.match(/^[*\-+]\s+(.*)$/);
      return bulletMatch ? `・${bulletMatch[1]}` : trimmed;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
