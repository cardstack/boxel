import {
  type ResolvedCodeRef,
  type CardDefMeta,
  SupportedMimeType,
  internalKeyFor,
} from './index';
import stringify from 'safe-stable-stringify';
import qs from 'qs';

export class DefinitionsCache {
  #fetch: typeof globalThis.fetch;
  #cache = new Map<string, CardDefMeta>();

  constructor(fetch: typeof globalThis.fetch) {
    this.#fetch = fetch;
  }

  invalidate() {
    this.#cache = new Map();
  }

  // for tests
  get cachedKeys() {
    return [...this.#cache.keys()];
  }

  async getDefinition(codeRef: ResolvedCodeRef): Promise<CardDefMeta> {
    let key = internalKeyFor(codeRef, undefined);
    let cached = this.#cache.get(key);
    if (cached) {
      return cached;
    }
    let definition = await this.fetchDefinition(codeRef);
    this.#cache.set(key, definition);
    return definition;
  }

  private async fetchDefinition(
    codeRef: ResolvedCodeRef,
  ): Promise<CardDefMeta> {
    let head: Response;
    try {
      head = await this.#fetch(codeRef.module, {
        method: 'HEAD',
      });
    } catch (e) {
      throw new Error(
        `Your filter refers to a nonexistent type: import { ${codeRef.name} } from "${codeRef.module}"`,
      );
    }
    if (!head.ok) {
      let message = await head.text();
      throw new Error(
        `tried to get card def meta for ${stringify(codeRef)}, but got ${head.status}: ${message} for HEAD ${codeRef.module}`,
      );
    }
    let realmURL = head.headers.get('X-Boxel-Realm-Url');
    if (!realmURL) {
      throw new Error(
        `could not determine realm URL for ${codeRef.module} when getting card def meta for ${stringify(codeRef)}`,
      );
    }
    let url = `${realmURL}_card-def?${qs.stringify({ codeRef })}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { accept: SupportedMimeType.JSONAPI },
      });
    } catch (e) {
      throw new Error(
        `Your filter refers to a nonexistent type: import { ${codeRef.name} } from "${codeRef.module}"`,
      );
    }
    if (!response.ok) {
      let message = await response.text();
      throw new Error(
        `tried to get card def meta for ${stringify(codeRef)}, but got ${response.status}: ${message} for ${url}`,
      );
    }
    let json = await response.json();
    return json.data.attributes as CardDefMeta;
  }
}
