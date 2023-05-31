import DOMPurify from 'dompurify';

let domPurify: DOMPurify.DOMPurifyI;

function getDOMPurify() {
  if (!domPurify) {
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

export function sanitize(markdown: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(markdown);
}
