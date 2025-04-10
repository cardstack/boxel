import DOMPurify from 'dompurify';

let _domPurify: DOMPurify.DOMPurifyI | undefined = undefined;
let customJsdom: any = null;

export function setCustomJsdom(jsdomInstance: any) {
  customJsdom = jsdomInstance;
  // Reset domPurify so it will be reinitialized with the new jsdom
  _domPurify = undefined;
}

function getDOMPurify() {
  if (!_domPurify) {
    // Use custom jsdom if provided, otherwise try to get from fastboot
    const jsdom = customJsdom || (globalThis as any).jsdom;
    _domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return _domPurify;
}

export function sanitizeHtml(html: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(html);
}
