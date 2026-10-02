// Pretui — file screening shared by FileTrigger and Dropzone.

// ═══════════════════════════════════════════════════════════════════════
// Screening — pure, no DOM. Unit-tested in controls-files.test.gts
// ═══════════════════════════════════════════════════════════════════════

/** The minimum a screening decision needs to know about a file. Declared
 * structurally rather than as `File` so the rules can be tested with object
 * literals instead of a constructed `File` (which needs a DOM). */
export interface ScreenableFile {
  name: string;
  /** MIME type; browsers hand back `''` for an unknown extension */
  type: string;
  size: number;
}

/** Why a file was refused. `detail` is human copy; `reason` is the code a
 * caller branches on. */
export interface FileRejection {
  name: string;
  reason: 'type' | 'size' | 'count';
  detail: string;
}

/** The outcome of screening a batch. */
export interface FileScreening<T extends ScreenableFile = ScreenableFile> {
  accepted: T[];
  rejected: FileRejection[];
}

/** The rules a batch is screened against. Every one is optional; with none
 * set, everything is accepted. */
export interface ScreenOptions {
  /** an `<input accept>` list — `'image/*, .csv, application/json'` */
  accept?: string;
  /** largest single file, in bytes */
  maxSize?: number;
  /** how many files may be taken in total */
  maxFiles?: number;
  /** false caps the batch at one file regardless of `maxFiles` */
  multiple?: boolean;
}

/** The file extension including its dot, lowercased, or `''`. */
function extensionOf(name: string): string {
  let dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Does a file satisfy one `accept` list?
 *
 * Implements the three token forms the HTML spec defines — `.ext`,
 * `type/subtype`, and `type/*` — and nothing else, so an unrecognised token
 * never widens the filter by accident. An empty or absent list accepts
 * everything, which is what a bare `<input type='file'>` does.
 *
 * The extension form is what makes this usable at all: browsers report
 * `type: ''` for plenty of real files (`.md`, `.gts`, anything the OS has no
 * mapping for), so a MIME-only matcher rejects files the user can plainly
 * see are the right kind.
 */
export function matchesAccept(
  candidate: ScreenableFile,
  accept?: string,
): boolean {
  let list = (accept ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) {
    return true;
  }
  let mime = (candidate.type ?? '').toLowerCase();
  let ext = extensionOf(candidate.name ?? '');
  for (let token of list) {
    if (token.startsWith('.')) {
      if (ext === token) {
        return true;
      }
    } else if (token.endsWith('/*')) {
      let group = token.slice(0, -1); // keeps the trailing slash
      if (mime.length > 0 && mime.startsWith(group)) {
        return true;
      }
    } else if (mime.length > 0 && mime === token) {
      return true;
    }
  }
  return false;
}

/** Bytes as a short human string. Deliberately local rather than borrowed
 * from `FormatBytes` (reading-format.gts) because this one feeds a plain
 * string message, not a template. */
function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < UNITS.length - 1) {
    value = value / 1024;
    index++;
  }
  let rounded =
    index === 0 ? String(Math.round(value)) : value.toFixed(value < 10 ? 1 : 0);
  return rounded + ' ' + UNITS[index];
}

/**
 * Split a batch into what may be taken and what must be refused, with a
 * reason for each refusal.
 *
 * Rules run in a fixed order — type, then size, then the count cap — so the
 * reason a user is told is the first thing actually wrong with the file
 * rather than whichever rule happened to be checked last. The count cap is
 * applied only to files that already passed the other two, so three
 * oversized images do not consume the three available slots.
 */
export function screenFiles<T extends ScreenableFile>(
  files: readonly T[],
  options: ScreenOptions = {},
): FileScreening<T> {
  let accepted: T[] = [];
  let rejected: FileRejection[] = [];
  let cap = options.multiple === false ? 1 : options.maxFiles;
  let limit =
    cap !== undefined && Number.isFinite(cap) && cap >= 0 ? cap : Infinity;

  for (let candidate of files) {
    if (!matchesAccept(candidate, options.accept)) {
      rejected.push({
        name: candidate.name,
        reason: 'type',
        detail: 'wrong file type',
      });
      continue;
    }
    if (
      options.maxSize !== undefined &&
      Number.isFinite(options.maxSize) &&
      candidate.size > options.maxSize
    ) {
      rejected.push({
        name: candidate.name,
        reason: 'size',
        detail: 'larger than ' + humanBytes(options.maxSize),
      });
      continue;
    }
    if (accepted.length >= limit) {
      rejected.push({
        name: candidate.name,
        reason: 'count',
        detail:
          limit === 1
            ? 'only one file at a time'
            : 'over the ' + limit + '-file limit',
      });
      continue;
    }
    accepted.push(candidate);
  }
  return { accepted, rejected };
}

/**
 * The sentence a status region reads out after a batch is screened.
 *
 * Pure and exported because it is the part a reviewer most wants to check
 * without a browser, and because a consumer that renders its own status
 * (an upload queue, say) should read the same words rather than invent
 * a second phrasing.
 */
export function screeningMessage(result: FileScreening): string {
  let parts: string[] = [];
  let taken = result.accepted.length;
  if (taken > 0) {
    let names = result.accepted.map((f) => f.name).join(', ');
    parts.push(
      (taken === 1 ? '1 file added' : taken + ' files added') + ': ' + names,
    );
  }
  for (let refusal of result.rejected) {
    parts.push(refusal.name + ' was not added — ' + refusal.detail);
  }
  if (parts.length === 0) {
    return 'No files were added.';
  }
  return parts.join('. ') + '.';
}
