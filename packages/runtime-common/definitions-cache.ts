import {
  type ResolvedCodeRef,
  type Definition,
  SupportedMimeType,
  internalKeyFor,
} from './index';
import stringify from 'safe-stable-stringify';
import qs from 'qs';

export class FilterRefersToNonexistentTypeError extends Error {
  codeRef: ResolvedCodeRef;

  constructor(codeRef: ResolvedCodeRef, opts?: { cause?: unknown }) {
    super(
      `Your filter refers to a nonexistent type: import { ${codeRef.name} } from "${codeRef.module}"`,
    );
    this.name = 'FilterRefersToNonexistentTypeError';
    this.codeRef = codeRef;
    if (opts?.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
    // make sure instances of this Error subclass behave like instances of the subclass should
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isFilterRefersToNonexistentTypeError(
  error: unknown,
): error is FilterRefersToNonexistentTypeError {
  return error instanceof FilterRefersToNonexistentTypeError;
}

export class DefinitionsCache {
  #fetch: typeof globalThis.fetch;
  #cache = new Map<string, Definition>();
  #missing = new Map<string, FilterRefersToNonexistentTypeError>();

  constructor(fetch: typeof globalThis.fetch) {
    this.#fetch = fetch;
  }

  invalidate() {
    this.#cache = new Map();
    this.#missing = new Map();
  }

  // for tests
  get cachedKeys() {
    return [...this.#cache.keys()];
  }

  async getDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
    let key = internalKeyFor(codeRef, undefined);
    let missing = this.#missing.get(key);
    if (missing) {
      throw missing;
    }
    let cached = this.#cache.get(key);
    if (cached) {
      return cached;
    }
    try {
      let definition = await this.fetchDefinition(codeRef);
      this.#cache.set(key, definition);
      this.#missing.delete(key);
      return definition;
    } catch (error) {
      if (isFilterRefersToNonexistentTypeError(error)) {
        this.#missing.set(key, error);
      }
      throw error;
    }
  }

  private async fetchDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
    let head: Response;
    try {
      head = await this.#fetch(codeRef.module, {
        method: 'HEAD',
      });
    } catch (e) {
      throw new FilterRefersToNonexistentTypeError(codeRef, { cause: e });
    }
    if (!head.ok) {
      let message = await head.text();
      if (head.status === 404) {
        throw new FilterRefersToNonexistentTypeError(codeRef);
      }
      throw new Error(
        `tried to get definition for ${stringify(codeRef)}, but got ${head.status}: ${message} for HEAD ${codeRef.module}`,
      );
    }
    let realmURL = head.headers.get('X-Boxel-Realm-Url');
    if (!realmURL) {
      throw new Error(
        `could not determine realm URL for ${codeRef.module} when getting card def meta for ${stringify(codeRef)}`,
      );
    }
    let url = `${realmURL}_definition?${qs.stringify({ codeRef })}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: SupportedMimeType.JSONAPI },
      });
    } catch (e) {
      throw new FilterRefersToNonexistentTypeError(codeRef, { cause: e });
    }
    if (!response.ok) {
      let message = await response.text();
      if (response.status === 404) {
        throw new FilterRefersToNonexistentTypeError(codeRef);
      }
      throw new Error(
        `tried to get definition for ${stringify(codeRef)}, but got ${response.status}: ${message} for ${url}`,
      );
    }
    let json = await response.json();
    return json.data.attributes as Definition;
  }
}
