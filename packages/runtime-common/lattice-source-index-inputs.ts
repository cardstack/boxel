import type { LatticeNativeSourceInput } from './lattice-native-index.ts';

// Ephemeral capability for one primary batch. Data can flow from a completed
// source evaluation before its row write finishes; the caller owns both row
// writes and registers both source checks in the same publication transaction.
export class LatticeSourceIndexInputs {
  #active = true;
  #recent = new Map<string, LatticeNativeSourceInput>();
  #loading = new Map<string, Promise<LatticeNativeSourceInput | undefined>>();
  #realmURL: string;
  #generation: number;
  #load: (url: string) => Promise<LatticeNativeSourceInput | undefined>;

  constructor(
    realmURL: string,
    generation: number,
    load: (url: string) => Promise<LatticeNativeSourceInput | undefined>,
  ) {
    this.#realmURL = realmURL;
    this.#generation = generation;
    this.#load = load;
  }

  remember(input: LatticeNativeSourceInput): void {
    if (!this.#active) throw new Error('Source indexing batch has ended');
    if (
      input.realmURL !== this.#realmURL ||
      input.generation !== this.#generation
    )
      throw new Error('Source input belongs to another indexing batch');
    if (
      input.resource.id !== input.url.replace(/\.json$/, '') ||
      input.resource.meta?.publication
    )
      throw new Error('Source input must be an ordinary indexed card');
    this.#recent.delete(input.url);
    this.#recent.set(input.url, input);
    // Sources are bounded by native admission's 1 MiB source limit. Do not
    // retain every GameLog of a from-scratch realm in worker memory.
    if (this.#recent.size > 16)
      this.#recent.delete(this.#recent.keys().next().value!);
  }

  async read(url: string): Promise<LatticeNativeSourceInput | undefined> {
    if (!this.#active) throw new Error('Source indexing batch has ended');
    const target = new URL(url);
    if (
      !url.startsWith(this.#realmURL) ||
      !target.pathname.endsWith('.json') ||
      target.search ||
      target.hash ||
      target.href !== url
    )
      return undefined;
    const cached = this.#recent.get(url);
    if (cached) return cached;
    let pending = this.#loading.get(url);
    if (!pending) {
      pending = this.#load(url)
        .then((input) => {
          if (!this.#active) throw new Error('Source indexing batch has ended');
          if (input) {
            if (input.url !== url)
              throw new Error('Source input identity mismatch');
            this.remember(input);
          }
          return input;
        })
        .finally(() => this.#loading.delete(url));
      this.#loading.set(url, pending);
    }
    return pending;
  }

  close(): void {
    this.#active = false;
    this.#recent.clear();
  }
}
