import { SupportedMimeType, CardError, isSingleCardDocument } from './index';

export async function loadDocument(
  fetch: typeof globalThis.fetch,
  url: string,
) {
  let response = await fetch(url, {
    headers: { Accept: SupportedMimeType.CardJson },
  });
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
  return json;
}
