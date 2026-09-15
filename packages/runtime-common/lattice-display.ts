import { CardError } from './error.ts';
import {
  isSingleCardDocument,
  type SingleCardDocument,
} from './document-types.ts';

export const LATTICE_DISPLAY_HAVE_HEADER = 'x-boxel-lattice-have';
export const LATTICE_DISPLAY_TOKEN_PREFIX = 'lattice-display-v1:';
export const LATTICE_DISPLAY_BATCH_SIZE = 16;
export const LATTICE_DISPLAY_REQUEST_LIMIT = 64 * 1024;
const TOKEN = /^lattice-display-v1:[a-f0-9]{64}$/;

// A display may retain a published value while its freshness is pending. A
// computation input may not. Keep this contract separate from input residency.
export interface LatticeDisplayReuse {
  lattice: {
    version: 1;
    reuse: true;
    token: string;
    id: string;
    state: 'ready' | 'pending';
  };
}

export function isLatticeDisplayToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function latticeDisplayHave(request: Request): string | undefined {
  let token = request.headers.get(LATTICE_DISPLAY_HAVE_HEADER);
  if (token === null) return undefined;
  if (!isLatticeDisplayToken(token)) {
    throw new CardError('Invalid Lattice display inventory', { status: 400 });
  }
  return token;
}

export function isLatticeDisplayReuse(
  value: unknown,
): value is LatticeDisplayReuse {
  if (!value || typeof value !== 'object' || 'data' in value) return false;
  let result = (value as LatticeDisplayReuse).lattice;
  return Boolean(
    result?.version === 1 &&
    result.reuse === true &&
    isLatticeDisplayToken(result.token) &&
    typeof result.id === 'string' &&
    (result.state === 'ready' || result.state === 'pending'),
  );
}

export interface LatticeDisplayBatchRequest {
  version: 1;
  session: string;
  epoch: number;
  required: string[];
  have: Array<{ url: string; token: string }>;
}

export type LatticeDisplayBatchResult = { url: string } & (
  | { publication: SingleCardDocument | LatticeDisplayReuse }
  | { error: { status: number; message: string } }
);

export interface LatticeDisplayBatchResponse {
  version: 1;
  session: string;
  epoch: number;
  results: LatticeDisplayBatchResult[];
}

// Canonical identities make exact coverage unambiguous. Authorization is still
// the serving realm's responsibility; neither Have nor a session grants access.
export function latticeDisplayBatchRequest(
  payload: unknown,
  realmURL: string,
): LatticeDisplayBatchRequest {
  let value = payload as LatticeDisplayBatchRequest | null;
  const invalid = () =>
    new CardError('Invalid Lattice display read request', { status: 400 });
  if (
    value?.version !== 1 ||
    typeof value.session !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.session) ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 0 ||
    !Array.isArray(value.required) ||
    value.required.length < 1 ||
    value.required.length > LATTICE_DISPLAY_BATCH_SIZE
  )
    throw invalid();
  let required = new Set<string>();
  for (let id of value.required) {
    if (typeof id !== 'string' || id.length > 4096) throw invalid();
    let url: URL;
    try {
      url = new URL(id);
    } catch {
      throw invalid();
    }
    if (
      url.href !== id ||
      !id.startsWith(realmURL) ||
      url.search ||
      url.hash ||
      url.pathname.endsWith('/') ||
      url.pathname.endsWith('.json') ||
      url.pathname.slice(new URL(realmURL).pathname.length).startsWith('_') ||
      required.has(id)
    )
      throw invalid();
    required.add(id);
  }
  let have = value.have ?? [];
  if (!Array.isArray(have) || have.length > required.size) throw invalid();
  let inventory = new Set<string>();
  for (let entry of have) {
    if (
      !entry ||
      !required.has(entry.url) ||
      inventory.has(entry.url) ||
      !isLatticeDisplayToken(entry.token)
    )
      throw invalid();
    inventory.add(entry.url);
  }
  return {
    version: 1,
    session: value.session,
    epoch: value.epoch,
    required: [...required],
    have,
  };
}

// Validate the entire response before applying any entry. Complete transport
// coverage includes explicit errors; it never means every card is ready.
export function latticeDisplayBatchResults(
  payload: unknown,
  request: LatticeDisplayBatchRequest,
  canonicalize: (id: string) => string = (id) => id,
): Map<string, LatticeDisplayBatchResult> {
  let value = payload as LatticeDisplayBatchResponse | null;
  const invalid = () =>
    new CardError('Incomplete or invalid Lattice display response', {
      status: 502,
    });
  if (
    value?.version !== 1 ||
    value.session !== request.session ||
    value.epoch !== request.epoch ||
    !Array.isArray(value.results) ||
    value.results.length !== request.required.length
  )
    throw invalid();
  let required = new Set(request.required);
  let results = new Map<string, LatticeDisplayBatchResult>();
  for (let entry of value.results) {
    if (!entry || !required.has(entry.url) || results.has(entry.url))
      throw invalid();
    if ('error' in entry) {
      if (
        'publication' in entry ||
        !entry.error ||
        !Number.isInteger(entry.error.status) ||
        entry.error.status < 400 ||
        entry.error.status > 599 ||
        typeof entry.error.message !== 'string'
      )
        throw invalid();
    } else {
      let publication = entry.publication;
      if (
        isLatticeDisplayReuse(publication) &&
        !request.have.some(
          (item) =>
            item.url === entry.url && item.token === publication.lattice.token,
        )
      )
        throw invalid();
      let id = isLatticeDisplayReuse(publication)
        ? publication.lattice.id
        : isSingleCardDocument(publication)
          ? publication.data.id
          : undefined;
      if (typeof id !== 'string') throw invalid();
      try {
        if (canonicalize(id) !== entry.url) throw invalid();
      } catch {
        throw invalid();
      }
    }
    results.set(entry.url, entry);
  }
  return results;
}
