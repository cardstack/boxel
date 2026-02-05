import {
  type SingleFileMetaDocument,
  isSingleCardDocument,
  isSingleFileMetaDocument,
  SupportedMimeType,
  CardError,
  isCardError,
} from './index';

async function loadDocumentWithRequest(
  fetch: typeof globalThis.fetch,
  url: string,
  requestURL: URL,
  accept: SupportedMimeType,
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
  return json;
}

export async function loadCardDocument(
  fetch: typeof globalThis.fetch,
  url: string,
) {
  let requestURL = new URL(!url.endsWith('.json') ? `${url}.json` : url);
  let json = await loadDocumentWithRequest(
    fetch,
    url,
    requestURL,
    SupportedMimeType.CardSource,
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
  if (!json.data.id) {
    // card source format is not serialized with the ID, so we add that back in.
    json.data.id = url;
  }
  return json;
}

export async function loadFileMetaDocument(
  fetch: typeof globalThis.fetch,
  url: string,
): Promise<SingleFileMetaDocument | CardError> {
  let requestURL = new URL(url);
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
    json.data.id = url;
  }
  return json;
}
