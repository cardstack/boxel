import { SupportedMimeType, CardError, isSingleCardDocument } from './index';

export type LoadDocumentOptions = {
  mode?: 'card' | 'file';
};

export async function loadDocument(
  fetch: typeof globalThis.fetch,
  url: string,
  opts?: LoadDocumentOptions,
) {
  let response: Response;
  let mode = opts?.mode ?? 'card';
  let requestURL =
    mode === 'file'
      ? new URL(url)
      : new URL(!url.endsWith('.json') ? `${url}.json` : url);
  requestURL.searchParams.set('noCache', 'true');
  try {
    response = await fetch(requestURL.href, {
      // there is a bunch of realm meta that is missing when we load a document
      // in this manner (card-src), hopefully that does not come back to bite
      // us. loading a document in this manner is useful because it allows us to
      // handle an index that is being built: where the document you are loading
      // might not have been added to the index yet. this allows us to remove
      // the visit() function when crawling the links of documents being indexed
      // and not finding the document yet in the index.
      headers: {
        Accept:
          mode === 'file'
            ? SupportedMimeType.FileMeta
            : SupportedMimeType.CardSource,
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
  if (!isSingleCardDocument(json)) {
    throw new Error(
      `instance ${url} is not a card document. it is: ${JSON.stringify(
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
