import { Parser } from "htmlparser2";

/** Elements whose content is not part of the note text. */
const SKIPPED = new Set(["head", "title", "style", "script", "noscript", "template"]);

/** Elements that end a line of text. */
const BLOCKS = new Set(["div", "p", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "li"]);

const CELL_SEPARATOR = " | ";

/** Drops the separators left after a row's last cell. A loop, not a regex: no backtracking. */
function trimTrailingCellSeparators(line: string): string {
  let end = line.length;
  while (end >= CELL_SEPARATOR.length && line.endsWith(CELL_SEPARATOR, end)) {
    end -= CELL_SEPARATOR.length;
  }
  return line.slice(0, end);
}

/** Deepest element nesting accepted in note HTML; real notes stay far below it. */
export const MAX_HTML_DEPTH = 1000;

/** Note HTML nested deeper than {@link MAX_HTML_DEPTH}: malformed or hostile content. */
export class HtmlTooDeepError extends RangeError {
  constructor() {
    super(
      `Note HTML is nested more than ${MAX_HTML_DEPTH} levels deep; SIDOF returned malformed content`,
    );
    this.name = "HtmlTooDeepError";
  }
}

/**
 * Converts the HTML SIDOF serves for a note into readable plain text: drops the head, styles
 * and scripts, keeps paragraph and table-row breaks, and separates table cells with " | ".
 *
 * Uses htmlparser2's streaming tokenizer. Its open-element stack costs O(depth) per tag, so
 * nesting is capped at {@link MAX_HTML_DEPTH}: broken upstream HTML fails fast with
 * {@link HtmlTooDeepError} instead of stalling the process.
 *
 * The result is plain text, not HTML: it can contain "<" and ">" (for example from a decoded
 * `&lt;`), so escape it before inserting it into a web page.
 */
export function htmlToText(html: string): string {
  let text = "";
  let skipDepth = 0;
  let depth = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (++depth > MAX_HTML_DEPTH) throw new HtmlTooDeepError();
        if (SKIPPED.has(name)) skipDepth++;
        else if (skipDepth === 0 && name === "br") text += "\n";
      },
      ontext(data) {
        if (skipDepth === 0) text += data;
      },
      onclosetag(name) {
        // Implied closes (unclosed tags, void elements) also land here, so depth stays exact.
        depth = Math.max(0, depth - 1);
        if (SKIPPED.has(name)) {
          skipDepth = Math.max(0, skipDepth - 1);
        } else if (skipDepth === 0) {
          if (name === "td" || name === "th") text += CELL_SEPARATOR;
          else if (BLOCKS.has(name)) text += "\n";
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  return text
    .split("\n")
    .map((line) => trimTrailingCellSeparators(line.replace(/[ \t\r ]+/g, " ")).trim())
    .filter((line, i, lines) => line !== "" || (i > 0 && lines[i - 1] !== ""))
    .join("\n")
    .trim();
}
