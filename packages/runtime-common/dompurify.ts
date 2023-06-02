import DOMPurify from 'dompurify';

let domPurify: DOMPurify.DOMPurifyI;

function getDOMPurify() {
  if (!domPurify) {
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

export function sanitizeHtml(html: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(html);
}
