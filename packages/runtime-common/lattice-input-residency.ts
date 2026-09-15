import { CardError } from './error.ts';
import type { SingleCardDocument } from './document-types.ts';

export const LATTICE_INPUT_TOKEN_PREFIX = 'lattice-input-v1:';
const TOKEN = /^lattice-input-v1:[a-f0-9]{64}$/;

export function isLatticeInputToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

// Have is an exact inventory, never an authorization credential. The caller
// has already normalized and authorized the requested realm-local identities.
export function latticeInputHave(
  payload: unknown,
  urls: URL[],
): Map<string, string> {
  let have = (payload as { have?: unknown } | null)?.have;
  let result = new Map<string, string>();
  if (have === undefined) return result;
  if (!Array.isArray(have) || have.length > urls.length) {
    throw new CardError('Invalid Lattice input inventory', { status: 400 });
  }
  let requested = new Set(urls.map((url) => url.href));
  for (let entry of have) {
    if (
      !entry ||
      typeof entry.url !== 'string' ||
      !requested.has(entry.url) ||
      result.has(entry.url) ||
      !isLatticeInputToken(entry.token)
    ) {
      throw new CardError('Invalid Lattice input inventory', { status: 400 });
    }
    result.set(entry.url, entry.token);
  }
  return result;
}

export interface LatticeResidentInput {
  token: string;
  document: SingleCardDocument;
  headers: Record<string, string>;
}

// Only immutable received documents live here, never CardDef instances or
// optimistic edits. Every consumer receives a clone. Entries must be validated
// again by an authenticated, generation-pinned server read before each reuse.
// These are retained-document bounds, not a claim about total JS heap size.
export class LatticeInputResidency {
  static MAX_ENTRIES = 256;
  static MAX_SERIALIZED_CHARACTERS = 4 * 1024 * 1024;
  #entries = new Map<
    string,
    { value: LatticeResidentInput; characters: number }
  >();
  #characters = 0;

  get(url: string): LatticeResidentInput | undefined {
    let entry = this.#entries.get(url);
    if (!entry) return undefined;
    this.#entries.delete(url);
    this.#entries.set(url, entry);
    return entry.value;
  }

  delete(url: string): void {
    let entry = this.#entries.get(url);
    if (!entry) return;
    this.#characters -= entry.characters;
    this.#entries.delete(url);
  }

  set(url: string, value: LatticeResidentInput): void {
    this.delete(url);
    let characters = JSON.stringify(value).length;
    if (characters > LatticeInputResidency.MAX_SERIALIZED_CHARACTERS) return;
    this.#entries.set(url, { value, characters });
    this.#characters += characters;
    while (
      this.#entries.size > LatticeInputResidency.MAX_ENTRIES ||
      this.#characters > LatticeInputResidency.MAX_SERIALIZED_CHARACTERS
    ) {
      this.delete(this.#entries.keys().next().value!);
    }
  }
}
