const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts the HTML SIDOF serves for a note into readable plain text: drops the head and
 * styles, keeps paragraph and table-row breaks, and separates table cells with " | ".
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/(div|p|tr|table|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t ]+/g, " ")
        .replace(/( \| )+$/, "")
        .trim(),
    )
    .filter((line, i, lines) => line !== "" || (i > 0 && lines[i - 1] !== ""))
    .join("\n")
    .trim();
}
