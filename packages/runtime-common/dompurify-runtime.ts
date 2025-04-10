import DOMPurify from 'dompurify';

let domPurify: DOMPurify.DOMPurifyI;

function getDOMPurify() {
  if (!domPurify) {
    //DOMPurify needs to be instantiated in the server-side rendering (using fastboot).
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

export function sanitizeHtml(html: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(html);
}
