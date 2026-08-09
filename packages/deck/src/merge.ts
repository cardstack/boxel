// Three-way merge over trees.
//
// A contribution in Deck is not a diff — it is a tree that exists, with a
// recorded base. That makes the merge inputs exact rather than inferred from
// a commit graph:
//
//   base   the upstream tree the fork was taken from (by treeHash)
//   ours   what upstream has published since
//   theirs the fork as it stands now
//
// Both halves are content-addressed, so "did this side change this file"
// is a hash comparison, not a heuristic. Only files BOTH sides touched need
// line-level work, which is why this stays cheap across hundreds of open
// proposals.

export interface TextMergeResult {
  text: string;
  conflicted: boolean;
}

// Beyond this, the O(n·m) alignment below stops being kind. A file that big
// which BOTH sides rewrote is a conflict a human should look at anyway, so
// we say so rather than grinding.
const MAX_MERGE_LINES = 5000;

export const CONFLICT_MARKER = '<<<<<<<';

function splitLines(text: string): string[] {
  // Keep the terminator on each line so a merge cannot silently change
  // whether a file ends with a newline.
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

// Longest common subsequence, as a map from base index → other index.
// Common prefix and suffix are peeled off first, which is what keeps real
// edits (a few lines in a long file) far away from the quadratic core.
function align(base: string[], other: string[]): (number | undefined)[] {
  let match: (number | undefined)[] = new Array(base.length).fill(undefined);
  let start = 0;
  while (
    start < base.length &&
    start < other.length &&
    base[start] === other[start]
  ) {
    match[start] = start;
    start++;
  }
  let endBase = base.length;
  let endOther = other.length;
  while (
    endBase > start &&
    endOther > start &&
    base[endBase - 1] === other[endOther - 1]
  ) {
    endBase--;
    endOther--;
    match[endBase] = endOther;
  }
  let rows = endBase - start;
  let cols = endOther - start;
  if (rows === 0 || cols === 0) {
    return match;
  }
  if (rows > MAX_MERGE_LINES || cols > MAX_MERGE_LINES) {
    return match; // treated as "nothing in the middle aligns"
  }
  // Classic LCS table over the unmatched middle.
  let table = new Int32Array((rows + 1) * (cols + 1));
  let at = (r: number, c: number) => r * (cols + 1) + c;
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      table[at(r, c)] =
        base[start + r] === other[start + c]
          ? table[at(r + 1, c + 1)] + 1
          : Math.max(table[at(r + 1, c)], table[at(r, c + 1)]);
    }
  }
  let r = 0;
  let c = 0;
  while (r < rows && c < cols) {
    if (base[start + r] === other[start + c]) {
      match[start + r] = start + c;
      r++;
      c++;
    } else if (table[at(r + 1, c)] >= table[at(r, c + 1)]) {
      r++;
    } else {
      c++;
    }
  }
  return match;
}

interface Chunk {
  baseFrom: number;
  baseTo: number;
  oursFrom: number;
  oursTo: number;
  theirsFrom: number;
  theirsTo: number;
}

// The regions between lines that BOTH sides left alone. Inside a stable
// region nothing can conflict; outside one, the three ranges are compared
// whole.
function chunksOf(
  base: string[],
  ours: string[],
  theirs: string[],
): { stable: boolean; chunk: Chunk }[] {
  let toOurs = align(base, ours);
  let toTheirs = align(base, theirs);
  let out: { stable: boolean; chunk: Chunk }[] = [];
  let baseAt = 0;
  let oursAt = 0;
  let theirsAt = 0;
  while (baseAt < base.length) {
    let o = toOurs[baseAt];
    let t = toTheirs[baseAt];
    if (o === oursAt && t === theirsAt) {
      // Stable line: same content, same position on both sides.
      let from = baseAt;
      while (
        baseAt < base.length &&
        toOurs[baseAt] === oursAt &&
        toTheirs[baseAt] === theirsAt
      ) {
        baseAt++;
        oursAt++;
        theirsAt++;
      }
      out.push({
        stable: true,
        chunk: {
          baseFrom: from,
          baseTo: baseAt,
          oursFrom: oursAt - (baseAt - from),
          oursTo: oursAt,
          theirsFrom: theirsAt - (baseAt - from),
          theirsTo: theirsAt,
        },
      });
      continue;
    }
    // Unstable: run to the next line both sides agree on.
    let baseFrom = baseAt;
    let oursFrom = oursAt;
    let theirsFrom = theirsAt;
    let nextBase = baseAt;
    while (nextBase < base.length) {
      let no = toOurs[nextBase];
      let nt = toTheirs[nextBase];
      if (no !== undefined && nt !== undefined && no >= oursAt && nt >= theirsAt) {
        break;
      }
      nextBase++;
    }
    let oursTo =
      nextBase < base.length ? (toOurs[nextBase] as number) : ours.length;
    let theirsTo =
      nextBase < base.length ? (toTheirs[nextBase] as number) : theirs.length;
    out.push({
      stable: false,
      chunk: {
        baseFrom,
        baseTo: nextBase,
        oursFrom,
        oursTo,
        theirsFrom,
        theirsTo,
      },
    });
    baseAt = nextBase;
    oursAt = oursTo;
    theirsAt = theirsTo;
  }
  // Whatever is left on either side after the last base line.
  if (oursAt < ours.length || theirsAt < theirs.length) {
    out.push({
      stable: false,
      chunk: {
        baseFrom: base.length,
        baseTo: base.length,
        oursFrom: oursAt,
        oursTo: ours.length,
        theirsFrom: theirsAt,
        theirsTo: theirs.length,
      },
    });
  }
  return out;
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

export function mergeText(
  base: string,
  ours: string,
  theirs: string,
): TextMergeResult {
  if (ours === theirs) {
    return { text: ours, conflicted: false };
  }
  if (base === ours) {
    return { text: theirs, conflicted: false };
  }
  if (base === theirs) {
    return { text: ours, conflicted: false };
  }
  let baseLines = splitLines(base);
  let ourLines = splitLines(ours);
  let theirLines = splitLines(theirs);
  let out: string[] = [];
  let conflicted = false;
  for (let { stable, chunk } of chunksOf(baseLines, ourLines, theirLines)) {
    let b = baseLines.slice(chunk.baseFrom, chunk.baseTo);
    let o = ourLines.slice(chunk.oursFrom, chunk.oursTo);
    let t = theirLines.slice(chunk.theirsFrom, chunk.theirsTo);
    if (stable) {
      out.push(...b);
      continue;
    }
    if (same(o, t)) {
      out.push(...o); // both sides made the same edit
    } else if (same(o, b)) {
      out.push(...t); // only the fork touched it
    } else if (same(t, b)) {
      out.push(...o); // only upstream touched it
    } else {
      conflicted = true;
      out.push(
        `${CONFLICT_MARKER} upstream\n`,
        ...ensureNewline(o),
        '||||||| base\n',
        ...ensureNewline(b),
        '=======\n',
        ...ensureNewline(t),
        '>>>>>>> proposal\n',
      );
    }
  }
  return { text: out.join(''), conflicted };
}

function ensureNewline(lines: string[]): string[] {
  if (lines.length === 0) {
    return lines;
  }
  let last = lines[lines.length - 1];
  return last.endsWith('\n')
    ? lines
    : [...lines.slice(0, -1), `${last}\n`];
}

// JSON is merged as DATA, not as lines.
//
// A line merge conflicts whenever two edits land next to each other, and in
// a pretty-printed object that happens constantly — adding a key makes the
// line above it grow a comma. Manifests and card instances are JSON, so
// line-merging them would make the daemon report conflicts that are not
// conflicts. Merging by key is both cheaper and exact: only the same key,
// changed differently on both sides, is a real disagreement.
//
// A merged JSON file is re-serialized (2-space, trailing newline), so a
// merge normalizes formatting. That only happens to files both sides
// changed — untouched files are passed through byte for byte.
export function mergeJsonValues(
  base: unknown,
  ours: unknown,
  theirs: unknown,
): { value: unknown; conflicted: boolean } {
  if (deepEqual(ours, theirs)) {
    return { value: ours, conflicted: false };
  }
  if (deepEqual(base, ours)) {
    return { value: theirs, conflicted: false };
  }
  if (deepEqual(base, theirs)) {
    return { value: ours, conflicted: false };
  }
  // Arrays are ordered and position-sensitive; merging them element-wise
  // would invent an order nobody wrote.
  if (!isPlainObject(ours) || !isPlainObject(theirs)) {
    return { value: theirs, conflicted: true };
  }
  let baseObject = isPlainObject(base) ? base : {};
  let value: Record<string, unknown> = {};
  let conflicted = false;
  for (let key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    let inBase = key in baseObject;
    let inOurs = key in ours;
    let inTheirs = key in theirs;
    let b = baseObject[key];
    let o = ours[key];
    let t = theirs[key];
    if (inOurs && inTheirs) {
      let merged = mergeJsonValues(inBase ? b : undefined, o, t);
      value[key] = merged.value;
      conflicted = conflicted || merged.conflicted;
      continue;
    }
    // Present on one side only: an ADD if the base never had it, otherwise
    // a DELETE by the other side.
    let present = inOurs ? o : t;
    if (!inBase) {
      value[key] = present;
      continue;
    }
    if (deepEqual(b, present)) {
      continue; // deleted on one side, untouched on the other
    }
    // Deleted on one side, changed on the other: keep the change and say so.
    value[key] = present;
    conflicted = true;
  }
  return { value, conflicted };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function parseJson(bytes: Buffer | undefined): unknown | undefined {
  if (bytes === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
}

function isText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8000).includes(0);
}

function equal(a: Buffer | undefined, b: Buffer | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.equals(b);
}

export interface TreeMergeResult {
  files: Map<string, Buffer>;
  // Paths where both sides changed in ways that cannot be reconciled. A
  // conflicted merge is REPORTED, never written: the daemon leaves the
  // proposal alone and says which files need a person.
  conflicts: string[];
}

export function mergeTrees(
  base: Map<string, Buffer>,
  ours: Map<string, Buffer>,
  theirs: Map<string, Buffer>,
): TreeMergeResult {
  let files = new Map<string, Buffer>();
  let conflicts: string[] = [];
  let paths = [
    ...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]),
  ].sort();
  for (let path of paths) {
    let b = base.get(path);
    let o = ours.get(path);
    let t = theirs.get(path);
    if (equal(o, t)) {
      // Both sides agree — including "both deleted it".
      if (o !== undefined) {
        files.set(path, o);
      }
      continue;
    }
    if (equal(o, b)) {
      // Only the proposal touched it.
      if (t !== undefined) {
        files.set(path, t);
      }
      continue;
    }
    if (equal(t, b)) {
      // Only upstream touched it.
      if (o !== undefined) {
        files.set(path, o);
      }
      continue;
    }
    if (o === undefined || t === undefined) {
      // One side deleted what the other edited: no merge can be right, so
      // keep the edit and make a person decide.
      conflicts.push(path);
      let kept = o ?? t;
      if (kept) {
        files.set(path, kept);
      }
      continue;
    }
    if (path.endsWith('.json')) {
      let ourJson = parseJson(o);
      let theirJson = parseJson(t);
      if (ourJson !== undefined && theirJson !== undefined) {
        let merged = mergeJsonValues(parseJson(b), ourJson, theirJson);
        if (merged.conflicted) {
          conflicts.push(path);
        }
        files.set(
          path,
          Buffer.from(JSON.stringify(merged.value, null, 2) + '\n', 'utf8'),
        );
        continue;
      }
      // Not parseable on one side — fall through to the text merge, which
      // will produce markers rather than pretend.
    }
    if (!isText(o) || !isText(t) || (b && !isText(b))) {
      conflicts.push(path);
      files.set(path, t);
      continue;
    }
    let merged = mergeText(
      b?.toString('utf8') ?? '',
      o.toString('utf8'),
      t.toString('utf8'),
    );
    if (merged.conflicted) {
      conflicts.push(path);
    }
    files.set(path, Buffer.from(merged.text, 'utf8'));
  }
  return { files, conflicts };
}
