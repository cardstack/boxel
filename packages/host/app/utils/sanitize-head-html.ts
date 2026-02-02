const ALLOWED_HEAD_TAGS = new Set(['meta', 'title']);
const ALLOWED_META_ATTRS = new Set(['name', 'property', 'content']);
const ALLOWED_TITLE_ATTRS = new Set<string>([]);

// Allowlist head markup before inserting into the document to reduce XSS risk.
export function sanitizeHeadHTML(
  headHTML: string,
  doc: Document,
): DocumentFragment | null {
  let template = doc.createElement('template');
  template.innerHTML = headHTML;

  let fragment = doc.createDocumentFragment();
  for (let node of Array.from(template.content.childNodes)) {
    let sanitized = sanitizeHeadNode(node, doc);
    if (sanitized) {
      fragment.appendChild(sanitized);
    }
  }

  return fragment.childNodes.length > 0 ? fragment : null;
}

function sanitizeHeadNode(node: Node, doc: Document): Node | null {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  let element = node as Element;
  let tagName = element.tagName.toLowerCase();
  if (!ALLOWED_HEAD_TAGS.has(tagName)) {
    return null;
  }

  switch (tagName) {
    case 'meta':
      return sanitizeMetaElement(element, doc);
    case 'title':
      return sanitizeTitleElement(element, doc);
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
