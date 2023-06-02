import DOMPurify from 'dompurify';

let domPurify: DOMPurify.DOMPurifyI;

function getDOMPurify() {
  if (!domPurify) {
    debugger;
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

export function sanitizeHtml(markdown: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(markdown);
}
