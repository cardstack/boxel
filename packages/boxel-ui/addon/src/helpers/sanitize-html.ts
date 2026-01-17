import { type SafeString, htmlSafe } from '@ember/template';
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

export function sanitizeHtml(html: string): string {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(html);
}

export function sanitizeHtmlSafe(html?: string): SafeString {
  if (!html) {
    return htmlSafe('');
  }
  return htmlSafe(sanitizeHtml(html));
}
