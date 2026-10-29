// How the frame takes on the app's styles. The app page resolves, where the
// frame sits, every custom property the fields' styles read and the text
// styles they inherit, and sends them over; these write them onto the frame's
// document through the CSSOM, which the secure origin's policy allows where it
// refuses a `style` attribute (ADR 008 §1.5).

export interface StyleMessage {
  properties?: Record<string, unknown>;
  inherited?: Record<string, unknown>;
  backdrop?: unknown;
  offset?: { x?: unknown; y?: unknown };
  width?: unknown;
}

// The text styles the fields inherit from the page.
const INHERITED_PROPERTIES = [
  'color',
  'color-scheme',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-rendering',
  '-webkit-font-smoothing',
];

// Asked of the page whatever the stylesheets read: it chooses the layout.
export const LAYOUT_PROPERTY = '--credential-layout';

// Custom properties the components' styles define for themselves, from the
// page's values, which the page is not asked for.
const LOCAL_PROPERTIES = new Set([
  '--icon-size',
  '--icon-space',
  '--_icon-full-length',
  '--icon-color',
  '--boxel-field-label-align',
  '--boxel-field-label-padding-top',
  '--boxel-label-letter-spacing',
]);

export function applyStyle(
  doc: Document,
  properties: string[],
  { properties: values, inherited, backdrop, offset, width }: StyleMessage,
) {
  let root = doc.documentElement;
  let body = doc.body;
  for (let name of properties) {
    let resolved = values?.[name];
    if (typeof resolved === 'string' && resolved.trim() !== '') {
      root.style.setProperty(name, resolved);
    } else {
      root.style.removeProperty(name);
    }
  }
  for (let name of INHERITED_PROPERTIES) {
    let resolved = inherited?.[name];
    if (typeof resolved === 'string' && resolved !== '') {
      (name === 'color-scheme' ? root : body).style.setProperty(name, resolved);
    }
  }
  // The solid color behind the frame in the page, when there is one, so
  // text here is drawn on an opaque background as the page's own is.
  if (typeof backdrop === 'string' && CSS.supports('color', backdrop)) {
    root.style.setProperty('background-color', backdrop);
  } else {
    root.style.removeProperty('background-color');
  }
  // The page puts the frame on the whole pixel at or before where the
  // fields it stands in for start, which may be part of the way into one.
  // Moving the content forward by that part, at the width the fields have
  // in the page, puts every edge and glyph on the pixel the page would have
  // drawn it on.
  let exactWidth = Number(width);
  if (Number.isFinite(exactWidth) && exactWidth > 0) {
    body.style.setProperty('width', `${exactWidth}px`);
  } else {
    body.style.removeProperty('width');
  }
  for (let [axis, side] of [
    ['x', 'left'],
    ['y', 'top'],
  ] as const) {
    let shift = Number(offset?.[axis]);
    if (Number.isFinite(shift) && Math.abs(shift) < 1) {
      body.style.setProperty(side, `${shift}px`);
    } else {
      body.style.removeProperty(side);
    }
  }
  root.classList.add('styled');
}

// The longest the fields wait on their stylesheets before asking the app for
// its styles. A stylesheet still loading by then is one the fields are better
// drawn without than not drawn at all.
export const STYLESHEET_WAIT_LIMIT_MS = 5000;

// Resolves once the document's stylesheets have loaded or failed to, so the
// fields are measured, and their custom properties read, in their own styles,
// or once the wait limit passes, so one that never settles leaves them drawn
// without it rather than hidden.
export function whenStyled(
  doc: Document,
  limitMs = STYLESHEET_WAIT_LIMIT_MS,
): Promise<void> {
  let pending = [
    ...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ].filter((link) => !link.sheet);
  let loaded = Promise.all(
    pending.map(
      (link) =>
        new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
  if (pending.length === 0) {
    return loaded;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, limitMs);
  });
  return Promise.race([loaded, limit]).finally(() => clearTimeout(timer));
}

// The custom properties the stylesheets read, so the page can be asked for
// exactly those.
export function customProperties(doc: Document): string[] {
  let names = new Set([LAYOUT_PROPERTY]);
  let pattern = /var\(\s*(--[\w-]+)/g;
  let visit = (rules: CSSRuleList) => {
    for (let rule of rules) {
      for (let match of rule.cssText.matchAll(pattern)) {
        names.add(match[1]);
      }
    }
  };
  for (let sheet of doc.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      continue;
    }
  }
  for (let local of LOCAL_PROPERTIES) {
    names.delete(local);
  }
  return [...names];
}
