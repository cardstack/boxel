import DOMPurify from 'dompurify';

let domPurify: DOMPurify.DOMPurifyI;
let customJsdom: any = null;

export function setCustomJsdom(jsdomInstance: any) {
  customJsdom = jsdomInstance;
  // Reset domPurify so it will be reinitialized with the new jsdom
  domPurify = undefined;
}

function getDOMPurify() {
  if (!domPurify) {
    // Use custom jsdom if provided, otherwise try to get from globalThis
    const jsdom = customJsdom || (globalThis as any).jsdom;
    domPurify = jsdom ? DOMPurify(jsdom.window) : DOMPurify;
  }

  return domPurify;
}

export function sanitizeHtml(html: string) {
  let domPurify = getDOMPurify();
  return domPurify.sanitize(html);
}
