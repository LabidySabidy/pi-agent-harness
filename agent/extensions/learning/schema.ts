/**
 * schema.ts — projection of the event log onto SCHEMA.md.
 *
 * SCHEMA.md has two writers: the authored prose (scaffold skill, human edits)
 * and this projection. To keep that safe, the projection touches ONLY the
 * regions it owns, never rewrites the document, and never deletes a registry
 * row — rows it does not know about are authored content and stay put.
 *
 * Idempotent by construction: every edit replaces a region rather than
 * accumulating, so projecting the same state twice is a no-op.
 */
import { BADGE_ALT, BADGE_LABEL, type Badge } from "./telemetry.ts";
import type { ReducedState } from "./events.ts";

export interface ProjectionResult {
  text: string;
  warnings: string[];
  changed: number;
}

export interface CardRef {
  badge: string;
  name: string;
  index: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Every `### <badge> <name>` heading in the document.
 *
 * The badge and the name are captured separately, never sliced: `⬜` is U+2B1C (one UTF-16
 * code unit) while 🟥🟨🟩🟦 are astral (two units), so any fixed-width slice is wrong for
 * exactly one of the five states.
 */
export function findCardHeadings(text: string): CardRef[] {
  const re = new RegExp(`^### (${BADGE_ALT})( .+)$`, "gmu");
  const out: CardRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ badge: m[1], name: m[2].trim(), index: m.index });
  }
  return out;
}

/**
 * Locate one concept card. Matches the exact name first, then its slug form.
 * Duplicate headings resolve to the FIRST card — the caller warns separately.
 */
export function findConceptCard(
  text: string,
  concept: string,
): { start: number; end: number; block: string; name: string } | null {
  for (const variant of [concept, slug(concept)]) {
    if (!variant) continue;
    const headingRe = new RegExp(`^### ${BADGE_ALT}( ${escapeRegExp(variant)}[ \\t]*)$`, "mu");
    const m = headingRe.exec(text);
    if (!m) continue;
    const start = m.index;
    const endMarker = text.indexOf("<!-- /CONCEPT CARD -->", start);
    const nextHeading = text.indexOf("\n### ", start + 1);
    const candidates = [endMarker, nextHeading].filter((i) => i !== -1);
    return {
      start,
      end: candidates.length > 0 ? Math.min(...candidates) : text.length,
      block: text.slice(start, candidates.length > 0 ? Math.min(...candidates) : text.length),
      name: m[1].trim(),
    };
  }
  return null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sanitizeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function splitRow(line: string): string[] {
  const cells = line.split("|").map((c) => c.trim());
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** Index of the separator line of the table whose header contains `marker`. */
function tableSeparatorIndex(lines: string[], headerMarker: string): number {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes(headerMarker) && lines[i].startsWith("|") && /^\|[\s-]+\|/.test(lines[i + 1])) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Apply the log's state to SCHEMA.md.
 * `today` is injected rather than read from the clock so the projection is a
 * pure function and its output is reproducible in tests.
 */
export function projectSchema(
  text: string,
  state: ReducedState,
  opts: { today: string },
): ProjectionResult {
  const warnings: string[] = [];
  let changed = 0;

  // --- duplicate concept headings are a real hazard: state splits across two
  // --- cards and the writer can only ever target one of them.
  const seen = new Map<string, number>();
  for (const h of findCardHeadings(text)) {
    seen.set(slug(h.name), (seen.get(slug(h.name)) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) warnings.push(`duplicate-concept:${key}`);
  }

  // --- concept cards -------------------------------------------------------
  for (const concept of state.concepts.values()) {
    const card = findConceptCard(text, concept.name);
    if (!card) {
      warnings.push(`unknown-concept:${concept.name}`);
      continue;
    }

    let block = card.block;

    if (concept.badge) {
      // Capture the badge and the name rather than slicing — see findCardHeadings.
      const headingRe = new RegExp(
        `^(### )(${BADGE_ALT})( ${escapeRegExp(card.name)}[ \\t]*)$`,
        "mu",
      );
      const m = headingRe.exec(block);
      if (m && m[2] !== concept.badge) {
        warnings.push(`badge_drift:${concept.name}:${m[2]}->${concept.badge}`);
        block = block.replace(headingRe, `$1${concept.badge}$3`);
      }
    }

    if (concept.badge) {
      const label = BADGE_LABEL[concept.badge as Badge] ?? "";
      block = block.replace(
        /(- \*\*Status:\*\* )(?:🟥|🟨|🟩|🟦|⬜)( [A-Za-z]+)?/,
        `$1${concept.badge} ${label}`,
      );
    }

    if (concept.sm2) {
      const next = addDays(opts.today, concept.sm2.interval);
      block = block.replace(/(`last_tested`: ).*/m, `$1${opts.today}`);
      block = block.replace(/(`next_review`: ).*/m, `$1${next}`);
      block = block.replace(/(`interval`: ).*/m, `$1${concept.sm2.interval}`);
      block = block.replace(/(`ease_factor`: ).*/m, `$1${concept.sm2.ease_factor}`);
      block = block.replace(/(`repetitions`: ).*/m, `$1${concept.sm2.repetitions}`);
    }

    if (concept.misconceptionIds.length > 0) {
      const ptr = [...concept.misconceptionIds].sort().join(", ");
      block = block.replace(/(- \*\*Misconceptions:\*\*).*/, `$1 ${ptr}`);
    }

    if (block !== card.block) {
      text = text.slice(0, card.start) + block + text.slice(card.end);
      changed++;
    }
  }

  // --- misconception registry (insert / update only — never delete) ---------
  const lines = text.split("\n");
  const sepAt = tableSeparatorIndex(lines, "Corrected model");
  if (sepAt !== -1) {
    // --- additive migration to the 7-column registry (severity) -----------------
    // Guarded: only fires on exactly the known 6-column shape, only appends a column,
    // and never removes one. Idempotent — a second pass finds 7 and does nothing.
    const headerCells = splitRow(lines[sepAt - 1]);
    const sepCells = splitRow(lines[sepAt]);
    const isKnownSixColumnShape =
      headerCells.length === 6 &&
      headerCells.some((c) => c.includes("Corrected model")) &&
      sepCells.length === 6;
    if (isKnownSixColumnShape) {
      lines[sepAt - 1] = lines[sepAt - 1].replace(/\|\s*$/, "| Severity |");
      lines[sepAt] = lines[sepAt].replace(/\|\s*$/, "|--------|");
      for (let i = sepAt + 1; i < lines.length && lines[i].startsWith("|"); i++) {
        if (splitRow(lines[i]).length === 6) lines[i] = lines[i].replace(/\|\s*$/, "|  |");
      }
      changed++;
      warnings.push("registry-migrated-to-7-columns");
    }

    // Surface pre-existing duplicate ids. They are NOT repaired: a duplicate row is
    // indistinguishable from an authored row by id alone, so automated deletion is the
    // one move that can destroy real content. Manual dedupe is documented in
    // docs/EVENT-SCHEMA.md.
    const idCounts = new Map<string, number>();
    for (let i = sepAt + 1; i < lines.length && lines[i].startsWith("|"); i++) {
      const m = /^\|\s*([A-Za-z]+-\d+)\s*\|/.exec(lines[i]);
      if (m) idCounts.set(m[1], (idCounts.get(m[1]) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      if (count > 1) warnings.push(`duplicate-registry-row:${id}`);
    }

    let inserted = 0;
    for (const row of [...state.misconceptions.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const newRow = `| ${row.id} | ${row.concept} | ${sanitizeCell(row.description)} | ${sanitizeCell(
        row.corrected,
      )} | ${row.status} | ${row.date} | ${row.severity || ""} |`;
      const at = lines.findIndex((l) => l.startsWith(`| ${row.id} `));
      if (at !== -1) {
        if (lines[at] !== newRow) {
          lines[at] = newRow;
          changed++;
        }
      } else {
        lines.splice(sepAt + 1 + inserted, 0, newRow);
        inserted++;
        changed++;
      }
    }
    text = lines.join("\n");
  } else if (state.misconceptions.size > 0) {
    warnings.push("no-registry-table");
  }

  // --- SM-2 summary table (update existing rows only) ----------------------
  const sm2Lines = text.split("\n");
  const sm2Sep = tableSeparatorIndex(sm2Lines, "repetitions");
  if (sm2Sep !== -1) {
    for (const concept of state.concepts.values()) {
      if (!concept.sm2) continue;
      const next = addDays(opts.today, concept.sm2.interval);
      const at = sm2Lines.findIndex((l, i) => {
        if (i <= sm2Sep || !l.startsWith("|")) return false;
        const cells = splitRow(l);
        return cells.length >= 6 && cells[0].toLowerCase() === concept.name.toLowerCase();
      });
      if (at === -1) continue;
      const updated = `| ${concept.name} | ${opts.today} | ${next} | ${concept.sm2.interval} | ${concept.sm2.ease_factor} | ${concept.sm2.repetitions} |`;
      if (sm2Lines[at] !== updated) {
        sm2Lines[at] = updated;
        changed++;
      }
    }
  }

  return { text: sm2Lines.join("\n"), warnings, changed };
}
