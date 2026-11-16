import { parse } from 'csv-parse/sync';
import { z } from 'zod';

const emailSchema = z.string().email().max(254);

export interface ParsedRecipients {
  valid: string[];
  invalid: { value: string; line: number; reason: string }[];
  duplicates: number;
  totalFound: number;
}

/**
 * Extracts email addresses from CSV or TXT content.
 * - CSV with a header containing "email" -> that column is used.
 * - Otherwise every cell/token is checked, so plain lists ("a@x.com\nb@y.com" or "a@x.com, b@y.com") work.
 * Output is lower-cased and de-duplicated, preserving first-seen order.
 */
export function parseRecipients(content: string): ParsedRecipients {
  const text = content.replace(/^\uFEFF/, '');
  const candidates: { value: string; line: number }[] = [];

  let rows: string[][] = [];
  try {
    rows = parse(text, { relax_column_count: true, skip_empty_lines: true, delimiter: [',', ';', '\t'], relax_quotes: true, trim: true });
  } catch {
    rows = text.split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((c) => c.trim()));
  }

  let emailCol = -1;
  let start = 0;
  if (rows.length) {
    const idx = rows[0].findIndex((c) => /^e-?mail(\s*address)?$/i.test(c.trim()));
    if (idx >= 0) { emailCol = idx; start = 1; }
  }
  for (let r = start; r < rows.length; r++) {
    const cells = emailCol >= 0 ? [rows[r][emailCol] ?? ''] : rows[r];
    for (const cell of cells) {
      // a TXT line may hold several whitespace separated entries
      for (const token of String(cell).split(/\s+/)) {
        const v = token.replace(/^["'<]+|["'>]+$/g, '').trim();
        if (v) candidates.push({ value: v, line: r + 1 });
      }
    }
  }

  const seen = new Set<string>();
  const out: ParsedRecipients = { valid: [], invalid: [], duplicates: 0, totalFound: candidates.length };
  for (const c of candidates) {
    const v = c.value.toLowerCase();
    if (!emailSchema.safeParse(v).success) {
      // ignore obvious non-email noise like names only when the file had no email column? report everything: user wants validation errors.
      out.invalid.push({ value: c.value, line: c.line, reason: 'Not a valid email address' });
    } else if (seen.has(v)) {
      out.duplicates++;
    } else {
      seen.add(v);
      out.valid.push(v);
    }
  }
  return out;
}
