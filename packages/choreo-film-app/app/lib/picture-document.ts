import { assetURL } from 'choreo-film-app/lib/assets';

/**
 * A film's picture: the WebGL page its `<IframePicture>` mounts, as markup for
 * the iframe's `srcdoc`.
 *
 * The realm serves an `.html` file navigated to in a frame as the host app's
 * file viewer, not as the page, so the page is fetched as card source and
 * handed over as text. Its `<base>` points at the media directory, where the
 * page's own scripts, looks and textures live. The page reads its query to
 * tell whether a film drives it; a document from `srcdoc` has no query, so the
 * page is told outright, with the `?host` the film would have put on its URL.
 */
export async function pictureDocument(
  name: 'sagrada' | 'towers'
): Promise<string> {
  const response = await fetch(assetURL(`${name}-model.html`), {
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok) {
    throw new Error(`${name}-model.html: ${response.status}`);
  }
  const html = await response.text();
  return html
    .replace(/\b(?:window\.)?location\.search/g, "'?host'")
    .replace(
      /<head[^>]*>/i,
      (head) => `${head}<base href="${assetURL().replaceAll('"', '&quot;')}">`
    );
}
