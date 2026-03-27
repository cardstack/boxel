import DOMPurify from 'dompurify';

let domPurify: typeof DOMPurify;

function getDOMPurify() {
  if (!domPurify) {
    //DOMPurify needs to be instantiated in the server-side rendering (using fastboot).
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

/** `sanitizeHtml` (and `sanitizeHtmlSafe` with return type HtmlSafe) is also
 * available as imports from `@cardstack/boxel-ui/helpers`. Due to issues this
 * package has regarding imports from `@ember/template`, this method exists in
 * duplicate places. */
export function sanitizeHtml(html: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(html);
}
