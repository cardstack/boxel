const ELEMENT_NODE = 1; // Node.ELEMENT_NODE - use constant to avoid reliance on global Node

const ALLOWED_HEAD_TAGS = new Set(['meta', 'title', 'link']);
const ALLOWED_META_ATTRS = new Set(['name', 'property', 'content']);
const ALLOWED_TITLE_ATTRS = new Set<string>([]);
const ALLOWED_LINK_ATTRS = new Set([
  'rel',
  'href',
  'type',
  'sizes',
  'media',
  'crossorigin',
  'integrity',
  'referrerpolicy',
  'fetchpriority',
]);
const SAFE_LINK_REL_TOKENS = new Set([
  'canonical',
  'icon',
  'shortcut',
  'apple-touch-icon',
  'mask-icon',
  'manifest',
]);

export function sanitizeHeadHTML(
  headHTML: string,
  doc: Document,
): DocumentFragment | null {
  if (typeof headHTML !== 'string') {
    return null;
  }

  let template = doc.createElement('template');
  template.innerHTML = headHTML;

  let fragment = doc.createDocumentFragment();
  for (let node of Array.from(template.content.childNodes)) {
    appendSanitizedHeadNodes(node, doc, fragment);
  }

  return fragment.childNodes.length > 0 ? fragment : null;
}

function appendSanitizedHeadNodes(
  node: Node,
  doc: Document,
  destination: DocumentFragment,
) {
  // Reject text/comments and recurse only through element containers.
  if (node.nodeType !== ELEMENT_NODE) {
    return;
  }

  let element = node as Element;
  let tagName = element.tagName.toLowerCase();
  if (ALLOWED_HEAD_TAGS.has(tagName)) {
    let sanitized = sanitizeAllowedHeadElement(element, doc);
    if (sanitized) {
      destination.appendChild(sanitized);
    }
    return;
  }

  // Allowlisted tags may be nested inside wrapper elements produced by
  // rendering infrastructure. We keep only the allowlisted descendants.
  for (let child of Array.from(element.childNodes)) {
    appendSanitizedHeadNodes(child, doc, destination);
  }
}

function sanitizeAllowedHeadElement(
  element: Element,
  doc: Document,
): Node | null {
  switch (element.tagName.toLowerCase()) {
    case 'meta':
      return sanitizeMetaElement(element, doc);
    case 'title':
      return sanitizeTitleElement(element, doc);
    case 'link':
      return sanitizeLinkElement(element, doc);
    default:
      return null;
  }
}

function sanitizeMetaElement(element: Element, doc: Document): HTMLMetaElement {
  let meta = doc.createElement('meta');
  copyAllowedAttributes(element, meta, ALLOWED_META_ATTRS);
  return meta;
}

function sanitizeTitleElement(
  element: Element,
  doc: Document,
): HTMLTitleElement {
  let title = doc.createElement('title');
  copyAllowedAttributes(element, title, ALLOWED_TITLE_ATTRS);
  title.textContent = element.textContent ?? '';
  return title;
}

function sanitizeLinkElement(
  element: Element,
  doc: Document,
): HTMLLinkElement | null {
  let relValue = element.getAttribute('rel') ?? '';
  if (!isSafeLinkRel(relValue)) {
    return null;
  }

  let href = element.getAttribute('href');
  if (href && !isSafeLinkHref(href, doc)) {
    return null;
  }

  let link = doc.createElement('link');
  copyAllowedAttributes(element, link, ALLOWED_LINK_ATTRS);
  return link;
}

function isSafeLinkRel(relValue: string): boolean {
  let tokens = relValue.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => SAFE_LINK_REL_TOKENS.has(token));
}

function isSafeLinkHref(href: string, doc: Document): boolean {
  let trimmed = href.trim();
  if (!trimmed) {
    return false;
  }

  try {
    // Use doc.baseURI if available, otherwise use a dummy base for relative URL parsing
    // In browser: doc.baseURI is the page URL
    // In Node.js with JSDOM: doc.baseURI may be 'about:blank', so we use a dummy https base
    let base = doc.baseURI;
    if (!base || base === 'about:blank') {
      base = 'https://example.com';
    }
    let url = new URL(trimmed, base);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeHeadHTMLToString(
  headHTML: string,
  doc: Document,
): string | null {
  let fragment = sanitizeHeadHTML(headHTML, doc);
  if (!fragment) {
    return null;
  }
  let container = doc.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML || null;
}

export function findDisallowedHeadTags(
  headHTML: string,
  doc: Document,
): string[] {
  if (typeof headHTML !== 'string') {
    return [];
  }

  let template = doc.createElement('template');
  template.innerHTML = headHTML;

  let disallowed = new Set<string>();
  for (let node of Array.from(template.content.childNodes)) {
    collectDisallowedHeadTags(node, disallowed);
  }
  return Array.from(disallowed);
}

function collectDisallowedHeadTags(
  node: Node,
  disallowed: Set<string>,
): boolean {
  if (node.nodeType !== ELEMENT_NODE) {
    return false;
  }

  let element = node as Element;
  let tagName = element.tagName.toLowerCase();
  if (ALLOWED_HEAD_TAGS.has(tagName)) {
    return true;
  }

  let hasAllowlistedDescendant = false;
  for (let child of Array.from(element.childNodes)) {
    hasAllowlistedDescendant =
      collectDisallowedHeadTags(child, disallowed) || hasAllowlistedDescendant;
  }

  // Wrapper-only nodes around allowlisted tags are expected from rendering
  // infrastructure and are stripped by the sanitizer, so we don't warn for
  // those wrappers.
  if (!hasAllowlistedDescendant) {
    disallowed.add(tagName);
  }
  return hasAllowlistedDescendant;
}

function copyAllowedAttributes(
  source: Element,
  target: Element,
  allowed: Set<string>,
) {
  for (let attribute of Array.from(source.attributes)) {
    let name = attribute.name.toLowerCase();
    if (allowed.has(name)) {
      target.setAttribute(attribute.name, attribute.value);
    }
  }
}
