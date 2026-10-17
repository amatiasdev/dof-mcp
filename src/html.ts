const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, entity: string) => {
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
 * Removes `<name ...>...</name>` blocks for the given element names in one linear scan. A block
 * without its closing tag is dropped to the end of the input, as a browser would treat it.
 */
function dropElements(html: string, names: string[]): string {
  const lower = html.toLowerCase();
  // Next opening position per name, reused until the scan passes it, so the total work stays
  // linear even when one element repeats many times and another appears once at the end.
  const next = new Map<string, number>();
  const findOpen = (name: string, from: number): number => {
    let at = lower.indexOf(`<${name}`, from);
    // Skip prefixes such as "<header" when looking for "<head".
    while (at !== -1 && /[a-z0-9]/.test(lower[at + name.length + 1] ?? "")) {
      at = lower.indexOf(`<${name}`, at + 1);
    }
    return at;
  };
  let out = "";
  let pos = 0;
  while (pos < html.length) {
    let start = -1;
    let name = "";
    for (const candidate of names) {
      let at = next.get(candidate);
      if (at === undefined || (at !== -1 && at < pos)) {
        at = findOpen(candidate, pos);
        next.set(candidate, at);
      }
      if (at !== -1 && (start === -1 || at < start)) {
        start = at;
        name = candidate;
      }
    }
    if (start === -1) break;
    out += html.slice(pos, start);
    const close = lower.indexOf(`</${name}`, start);
    if (close === -1) return out;
    const end = lower.indexOf(">", close);
    pos = end === -1 ? html.length : end + 1;
  }
  return out + html.slice(pos);
}

/**
 * Converts the HTML SIDOF serves for a note into readable plain text: drops the head and
 * styles, keeps paragraph and table-row breaks, and separates table cells with " | ".
 * Runs in linear time, so malformed upstream HTML cannot stall the process.
 */
export function htmlToText(html: string): string {
  const text = dropElements(html, ["head", "style", "script"])
    .replace(/<!DOCTYPE[^<>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<\/(div|p|tr|table|h[1-6]|li)\s*>/gi, "\n")
    // Only strip things that look like tags, and never across another "<", so a stray "<" in
    // legal text survives and matching stays linear.
    .replace(/<\/?[a-z!][^<>]*>/gi, "");
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
