import {
  type SingleFileMetaDocument,
  isSingleCardDocument,
  isSingleFileMetaDocument,
  SupportedMimeType,
  CardError,
  isCardError,
} from './index.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import {
  isLatticeInputToken,
  LatticeInputResidency,
} from './lattice-input-residency.ts';
import { recordLatticeBrowserInput } from './lattice-browser-inputs.ts';
import {
  LATTICE_INPUT_GENERATION_HEADER,
  MAX_LATTICE_INPUT_BATCH_SIZE,
  type LatticeInputResult,
  type LatticeInputSnapshot,
} from './lattice-materialization.ts';

type InputRead = {
  promise: Promise<ResolvedInput>;
  resolve: (result: ResolvedInput) => void;
};
type ResolvedInput = Exclude<LatticeInputResult, { reuse: true }>;
type InputBatch = {
  reads: Map<string, InputRead>;
  pending: Set<string>;
  running: boolean;
};
// Coalesce actual card reads within one computation/authenticated fetch. The
// separate document residency below is never sufficient without a server read.
const inputBatches = new WeakMap<
  typeof globalThis.fetch,
  WeakMap<LatticeInputSnapshot, InputBatch>
>();
const inputResidency = new WeakMap<
  typeof globalThis.fetch,
  LatticeInputResidency
>();

async function loadLatticeInput(
  fetch: typeof globalThis.fetch,
  url: string,
  snapshot: LatticeInputSnapshot,
) {
  let snapshots = inputBatches.get(fetch);
  if (!snapshots) inputBatches.set(fetch, (snapshots = new WeakMap()));
  let batch = snapshots.get(snapshot);
  if (!batch) {
    snapshots.set(
      snapshot,
      (batch = {
        reads: new Map(),
        pending: new Set(),
        running: false,
      }),
    );
  }
  let read = batch.reads.get(url);
  if (!read) {
    let resolve!: InputRead['resolve'];
    let promise = new Promise<ResolvedInput>((done) => (resolve = done));
    read = { promise, resolve };
    batch.reads.set(url, read);
    batch.pending.add(url);
  }
  if (!batch.running) {
    batch.running = true;
    // Prerendering disables timers. Gather this microtask's independent reads
    // without depending on a browser timer or a component lifecycle.
    queueMicrotask(() => void flushLatticeInputs(fetch, snapshot, batch));
  }
  return read.promise;
}

async function flushLatticeInputs(
  fetch: typeof globalThis.fetch,
  snapshot: LatticeInputSnapshot,
  batch: InputBatch,
) {
  let residency = inputResidency.get(fetch);
  if (!residency) {
    inputResidency.set(fetch, (residency = new LatticeInputResidency()));
  }
  while (batch.pending.size) {
    let urls = [...batch.pending].slice(0, MAX_LATTICE_INPUT_BATCH_SIZE);
    for (let url of urls) batch.pending.delete(url);
    // Pin advertised documents until this request settles. LRU eviction by a
    // concurrent scope cannot turn a valid reuse response into missing data.
    let resident = new Map(
      urls.flatMap((url) => {
        let value = residency.get(url);
        return value ? [[url, value] as const] : [];
      }),
    );
    let results: ResolvedInput[];
    try {
      let endpoint = new URL('_lattice-inputs', snapshot.realmURL);
      let response = await fetch(endpoint.href, {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
          [LATTICE_INPUT_GENERATION_HEADER]: String(snapshot.generation),
        },
        body: JSON.stringify({
          urls,
          ...(snapshot.retainLinks ? { retainLinks: true } : {}),
          ...(resident.size
            ? {
                have: [...resident].map(([url, { token }]) => ({ url, token })),
              }
            : {}),
        }),
      });
      if (!response.ok) {
        let error = await CardError.fromFetchResponse(endpoint.href, response);
        // Error payloads may be plain JSON. The failed HTTP request, rather
        // than a per-card result, owns the status at this transport boundary.
        throw new CardError(error.message, { status: response.status });
      }
      let payload = await response.json();
      let received: LatticeInputResult[] = payload?.results;
      if (
        !Array.isArray(received) ||
        received.length !== urls.length ||
        new Set(received.map((result) => result?.url)).size !== urls.length ||
        received.some(
          (result) =>
            !result ||
            typeof result !== 'object' ||
            !urls.includes(result.url) ||
            ['document', 'reuse', 'error'].filter((key) => key in result)
              .length !== 1 ||
            !('document' in result
              ? isSingleCardDocument(result.document) &&
                result.headers &&
                typeof result.headers === 'object'
              : 'reuse' in result
                ? result.reuse === true &&
                  isLatticeInputToken(result.token) &&
                  resident.get(result.url)?.token === result.token
                : 'error' in result &&
                  typeof result.error?.message === 'string' &&
                  typeof result.error.status === 'number'),
        )
      ) {
        throw new CardError('Invalid Lattice input batch response', {
          status: 502,
        });
      }
      results = received.map((result) => {
        if (snapshot.retainLinks && !('error' in result))
          recordLatticeBrowserInput(
            snapshot,
            result.url,
            result.receipt!,
            payload.authority,
          );
        if ('reuse' in result) {
          return { url: result.url, ...resident.get(result.url)! };
        }
        if (
          'document' in result &&
          isLatticeInputToken(result.token) &&
          (!result.document.data.meta.publication ||
            result.document.data.meta.publication.state === 'ready')
        ) {
          residency.set(result.url, {
            document: result.document,
            headers: result.headers,
            token: result.token,
          });
        } else {
          residency.delete(result.url);
        }
        return result;
      });
    } catch (error) {
      for (let url of urls) residency.delete(url);
      results = urls.map((url) => ({
        url,
        error: {
          message: error instanceof Error ? error.message : String(error),
          // A failed batch endpoint cannot attest that its requested cards
          // are absent. Only per-input results from a successful reply may
          // carry authoritative 404s; keep other transport statuses intact.
          status: isCardError(error)
            ? error.status === 404
              ? 502
              : error.status
            : 500,
          additionalErrors: null,
        },
      }));
    }
    for (let result of results) {
      batch.reads.get(result.url)!.resolve(result);
      batch.reads.delete(result.url);
    }
  }
  batch.running = false;
}

function applyResponseMetadata(json: any, headers: Headers) {
  let realmURL = headers.get('x-boxel-realm-url');
  let lastModified = headers.get('last-modified');
  if (
    json &&
    typeof json === 'object' &&
    json.data &&
    typeof json.data === 'object' &&
    !Array.isArray(json.data) &&
    (realmURL || lastModified)
  ) {
    let lastModifiedMS =
      lastModified != null ? new Date(lastModified).getTime() : undefined;
    json.data.meta = {
      ...(json.data.meta ?? {}),
      ...(realmURL ? { realmURL } : {}),
      ...(lastModifiedMS != null && !Number.isNaN(lastModifiedMS)
        ? { lastModified: lastModifiedMS }
        : {}),
    };
  }
  return json;
}

async function loadDocumentWithRequest(
  fetch: typeof globalThis.fetch,
  url: string,
  requestURL: URL,
  accept: SupportedMimeType,
  extraHeaders?: Record<string, string>,
) {
  let response: Response;
  requestURL.searchParams.set('noCache', 'true');
  try {
    response = await fetch(requestURL.href, {
      // there is a bunch of realm meta that is missing when we load a document
      // in this manner (card-src/file-meta), hopefully that does not come back
      // to bite us. loading a document in this manner is useful because it
      // allows us to handle an index that is being built: where the document
      // you are loading might not have been added to the index yet. this
      // allows us to remove the visit() function when crawling the links of
      // documents being indexed and not finding the document yet in the index.
      headers: {
        Accept: accept,
        ...extraHeaders,
      },
    });
  } catch (err: any) {
    let message = err?.message ?? String(err ?? '');
    // Normalize browser vs Node fetch error wording for consistency in tests
    if (/^Failed to fetch$/i.test(message)) {
      message = 'fetch failed';
    }
    let cardError = new CardError(`unable to fetch ${url}: ${message}`, err);
    cardError.deps = [url];
    return cardError;
  }
  if (!response.ok) {
    let cardError = await CardError.fromFetchResponse(url, response);
    cardError.deps = [url];
    return cardError;
  }
  return applyResponseMetadata(await response.json(), response.headers);
}

export async function loadCardDocument(
  fetch: typeof globalThis.fetch,
  url: string,
  virtualNetwork: VirtualNetwork,
  lattice?: LatticeInputSnapshot,
) {
  let target = lattice
    ? url.replace(/\.json$/, '')
    : !url.endsWith('.json')
      ? `${url}.json`
      : url;
  let requestURL = virtualNetwork.toURL(target);
  if (lattice && !requestURL.href.startsWith(lattice.realmURL)) {
    return new CardError('Lattice indexed inputs must be in the owner realm', {
      status: 400,
    });
  }
  let json;
  if (lattice) {
    let result = await loadLatticeInput(fetch, requestURL.href, lattice);
    if ('error' in result) {
      let error: CardError = CardError.fromSerializableError({
        ...result.error,
        isCardError: true,
      });
      error.deps = [url];
      return error;
    }
    // Deserializers may mutate their input. Coalesced readers own independent
    // documents, including when two identity spellings map to the same URL.
    json = applyResponseMetadata(
      structuredClone(result.document),
      new Headers(result.headers),
    );
  } else {
    json = await loadDocumentWithRequest(
      fetch,
      url,
      requestURL,
      SupportedMimeType.CardSource,
    );
  }
  if (isCardError(json)) {
    return json;
  }
  if (!isSingleCardDocument(json)) {
    throw new Error(
      `instance ${url} is not a card resource document. it is: ${JSON.stringify(
        json,
        null,
        2,
      )}`,
    );
  }
  if (
    lattice &&
    json.data.meta.publication &&
    json.data.meta.publication.state !== 'ready'
  ) {
    return new CardError(
      'Lattice feeder is pending; defer its dependent owner',
      { status: 409 },
    );
  }
  if (!json.data.id) {
    // card source format is not serialized with the ID, so we add that back in.
    json.data.id = url as RealmResourceIdentifier;
  }
  return json;
}

export async function loadFileMetaDocument(
  fetch: typeof globalThis.fetch,
  url: string,
  virtualNetwork: VirtualNetwork,
): Promise<SingleFileMetaDocument | CardError> {
  let requestURL = virtualNetwork.toURL(url);
  let json = await loadDocumentWithRequest(
    fetch,
    url,
    requestURL,
    SupportedMimeType.FileMeta,
  );
  if (isCardError(json)) {
    return json;
  }
  if (!isSingleFileMetaDocument(json)) {
    throw new Error(
      `instance ${url} is not a file meta resource document. it is: ${JSON.stringify(
        json,
        null,
        2,
      )}`,
    );
  }
  if (!json.data.id) {
    // card source format is not serialized with the ID, so we add that back in.
    json.data.id = url as RealmResourceIdentifier;
  }
  return json;
}
