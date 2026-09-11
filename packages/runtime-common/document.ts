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
  TESSAR_INPUT_GENERATION_HEADER,
  type TessarInputSnapshot,
} from './tessar-materialization.ts';

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
  let json = await response.json();
  let realmURL = response.headers.get('x-boxel-realm-url');
  let lastModified = response.headers.get('last-modified');
  if (
    json &&
    typeof json === 'object' &&
    'data' in json &&
    json.data &&
    typeof json.data === 'object' &&
    !Array.isArray(json.data) &&
    (realmURL || lastModified)
  ) {
    let lastModifiedMS =
      lastModified != null ? new Date(lastModified).getTime() : undefined;
    (json.data as { meta?: Record<string, unknown> }).meta = {
      ...((json.data as { meta?: Record<string, unknown> }).meta ?? {}),
      ...(realmURL ? { realmURL } : {}),
      ...(lastModifiedMS != null && !Number.isNaN(lastModifiedMS)
        ? { lastModified: lastModifiedMS }
        : {}),
    };
  }
  return json;
}

export async function loadCardDocument(
  fetch: typeof globalThis.fetch,
  url: string,
  virtualNetwork: VirtualNetwork,
  tessar?: TessarInputSnapshot,
) {
  let target = tessar
    ? url.replace(/\.json$/, '')
    : !url.endsWith('.json')
      ? `${url}.json`
      : url;
  let requestURL = virtualNetwork.toURL(target);
  if (tessar && !requestURL.href.startsWith(tessar.realmURL)) {
    return new CardError('Tessar indexed inputs must be in the owner realm', {
      status: 400,
    });
  }
  let json = await loadDocumentWithRequest(
    fetch,
    url,
    requestURL,
    tessar ? SupportedMimeType.CardJson : SupportedMimeType.CardSource,
    tessar
      ? { [TESSAR_INPUT_GENERATION_HEADER]: String(tessar.generation) }
      : undefined,
  );
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
    tessar &&
    json.data.meta.tessar &&
    json.data.meta.tessar.state !== 'ready'
  ) {
    return new CardError(
      'Tessar feeder is pending; defer its dependent owner',
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
