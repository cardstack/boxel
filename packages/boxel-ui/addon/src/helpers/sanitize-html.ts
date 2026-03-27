import { type SafeString, htmlSafe } from '@ember/template';
import DOMPurify from 'dompurify';

let domPurify: typeof DOMPurify;
const SANITIZED_HTML_CACHE_LIMIT = 500;
const sanitizedHtmlCache = new Map<string, string>();

function getDOMPurify() {
  if (!domPurify) {
    //DOMPurify needs to be instantiated in the server-side rendering (using fastboot).
    let jsdom = (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

export function sanitizeHtml(html: string): string {
  let cached = sanitizedHtmlCache.get(html);
  if (cached !== undefined) {
    return cached;
  }

  let domPurify = getDOMPurify();
  let sanitized = domPurify.sanitize(html);
  sanitizedHtmlCache.set(html, sanitized);

  // Sanitization is pure for a given input/config, so bounded memoization lets
  // repeated rerenders reuse the same result instead of reparsing identical HTML.
  if (sanitizedHtmlCache.size > SANITIZED_HTML_CACHE_LIMIT) {
    let oldestKey = sanitizedHtmlCache.keys().next().value;
    if (oldestKey !== undefined) {
      sanitizedHtmlCache.delete(oldestKey);
    }
  }

  return sanitized;
}

export function sanitizeHtmlSafe(html?: string): SafeString {
  if (!html) {
    return htmlSafe('');
  }
  return htmlSafe(sanitizeHtml(html));
}
