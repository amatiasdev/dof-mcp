import { Parser } from "htmlparser2";

/** Elements whose content is not part of the note text. */
const SKIPPED = new Set(["head", "title", "style", "script", "noscript", "template"]);

/** Elements that end a line of text. */
const BLOCKS = new Set(["div", "p", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "li"]);

/**
 * Converts the HTML SIDOF serves for a note into readable plain text: drops the head, styles
 * and scripts, keeps paragraph and table-row breaks, and separates table cells with " | ".
 *
 * Uses htmlparser2's streaming tokenizer, which handles malformed markup in linear time, so
 * broken upstream HTML cannot stall the process.
 *
 * The result is plain text, not HTML: it can contain "<" and ">" (for example from a decoded
 * `&lt;`), so escape it before inserting it into a web page.
 */
export function htmlToText(html: string): string {
  let text = "";
  let skipDepth = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIPPED.has(name)) skipDepth++;
        else if (skipDepth === 0 && name === "br") text += "\n";
      },
      ontext(data) {
        if (skipDepth === 0) text += data;
      },
      onclosetag(name) {
        if (SKIPPED.has(name)) {
          skipDepth = Math.max(0, skipDepth - 1);
        } else if (skipDepth === 0) {
          if (name === "td" || name === "th") text += " | ";
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
    .map((line) =>
      line
        .replace(/[ \t\r ]+/g, " ")
        .replace(/( \| )+$/, "")
        .trim(),
    )
    .filter((line, i, lines) => line !== "" || (i > 0 && lines[i - 1] !== ""))
    .join("\n")
    .trim();
}
