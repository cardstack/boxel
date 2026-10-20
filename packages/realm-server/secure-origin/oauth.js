/* eslint-env browser */
// OAuth approval lives entirely on the secure origin. Only a provider-issued
// authorization code reaches the client; this window's session never does.
//
// Everything a client registered (its name, its redirect host) is untrusted:
// it is only ever set as text, never as markup or an attribute that loads
// anything.
import {
  readConfig,
  signOut,
  storedSession,
  storeSession,
  forgetSession,
} from './session.js';
import { renderSignIn } from './sign-in.js';

// What each scope lets an application do, in the words the dialog uses. The
// provider refuses any scope not listed here, so an unknown one is shown
// as-is rather than dropped.
const SCOPE_COPY = {
  openid: {
    icon: 'person',
    title: 'See your Boxel account ID',
  },
  'boxel:read': {
    icon: 'eye',
    title: 'Read cards and files',
    detail: 'In the workspaces you choose below.',
  },
  'boxel:choices': {
    icon: 'bookmark',
    title: 'Remember your choices',
    detail:
      'Keeps its own saved selections and preferences for you. This alone never changes a workspace.',
  },
  'boxel:write': {
    icon: 'pencil',
    title: 'Save changes to cards',
    detail:
      'Edits are made as you, only in chosen workspaces where you can edit.',
    caution: true,
  },
};

// Short names for the connected-applications list.
const SCOPE_CHIPS = {
  'boxel:read': 'Read',
  'boxel:write': 'Save changes',
  'boxel:choices': 'Remembers choices',
};

// A name this long is shortened in the title, which must stay readable, and
// shown whole with the application's other details.
const TITLE_NAME_LIMIT = 60;

// Boxel's own links, the same ones boxel.ai's footer carries. Nothing an
// application registered ever appears in the page's chrome.
const FOOTER_LINKS = [
  ['Privacy', 'https://boxel.ai/privacy'],
  ['Terms', 'https://boxel.ai/terms'],
  ['Support', 'https://discord.gg/boxel'],
];

const RENEWAL_DAYS = 30;
// The provider's access token lifetime, for a connection that doesn't renew.
const ACCESS_MINUTES = 5;

// Builds an element. Text is only ever set as text, never as markup.
function h(tag, attributes = {}, ...children) {
  let node = document.createElement(tag);
  for (let [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false || value === null) {
      continue;
    }
    node.setAttribute(name, value === true ? '' : value);
  }
  node.append(
    ...children.filter(
      (child) => child !== undefined && child !== null && child !== false,
    ),
  );
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  person: [
    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6',
  ],
  eye: [
    'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  ],
  bookmark: ['M6 3h12v18l-6-4-6 4V3Z'],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  'pencil-off': ['M4 20h4L19 9l-4-4L4 16v4Z', 'M3 3l18 18'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  shield: ['M12 3l8 3v6c0 4.4-3.4 8.2-8 9-4.6-.8-8-4.6-8-9V6l8-3Z'],
  alert: ['M12 3l10 18H2L12 3Z', 'M12 10v4', 'M12 17.5v.01'],
  arrows: ['M4 9h14l-3-3', 'M20 15H6l3 3'],
  chevron: ['M9 6l6 6-6 6'],
};

function icon(name) {
  let svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'oauth-icon');
  for (let d of ICON_PATHS[name] ?? []) {
    let path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Boxel's mark, copied from boxel-ui's BoxelIcon: the secure origin loads
// nothing from the app.
const BOXEL_MARK_PATHS = [
  [
    'M17 22H5a5.006 5.006 0 0 1-5-5V5a5.006 5.006 0 0 1 5-5h12a5.005 5.005 0 0 1 5 5v12a5.006 5.006 0 0 1-5 5M3.271 2.425a.907.907 0 0 0-.682 1.515 1 1 0 0 0 .047.052L5.85 7.18a1.68 1.68 0 0 1 .433 1.039v5.566a1.68 1.68 0 0 1-.433 1.039l-3.215 3.188a1 1 0 0 0-.049.057.923.923 0 0 0 .7 1.509.9.9 0 0 0 .673-.3l3.15-3.128a1.7 1.7 0 0 1 1.042-.429h5.7a1.7 1.7 0 0 1 1.042.429l3.187 3.16a1 1 0 0 0 .051.045.9.9 0 0 0 .58.213.924.924 0 0 0 .7-1.508l-.037-.041-.007-.007-.036-.037-3.179-3.152a1.68 1.68 0 0 1-.432-1.039V8.219a1.68 1.68 0 0 1 .433-1.039l3.118-3.092a.923.923 0 0 0-.559-1.645.9.9 0 0 0-.492.148.6.6 0 0 0-.139.1l-3.187 3.16a1.7 1.7 0 0 1-1.042.429h-5.7a1.7 1.7 0 0 1-1.042-.429L3.922 2.694l-.053-.047a.92.92 0 0 0-.598-.222',
  ],
  [
    'M1.117 0H4.97a1.117 1.117 0 0 1 1.117 1.117V4.97A1.117 1.117 0 0 1 4.97 6.087H1.117A1.117 1.117 0 0 1 0 4.97V1.117A1.117 1.117 0 0 1 1.117 0',
    'translate(7.968 8.018)',
  ],
];

function boxelMark() {
  let svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'oauth-boxel-mark');
  for (let [d, transform] of BOXEL_MARK_PATHS) {
    let path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (transform) {
      path.setAttribute('transform', transform);
    }
    svg.append(path);
  }
  return svg;
}

// The wordmark the app's top bar shows, copied from boxel-ui's
// BoxelIconWithText (mark on its dark tile, then "boxel").
const BOXEL_WORDMARK_PATHS = [
  ['#000000', 'M9 0h4c5 0 9 4 9 9v4c0 5-4 9-9 9H9c-5 0-9-4-9-9V9c0-5 4-9 9-9'],
  [
    '#00ffba',
    'M17 22H5c-2.8 0-5-2.2-5-5V5c0-2.8 2.2-5 5-5h12c2.8 0 5 2.2 5 5v12c0 2.8-2.2 5-5 5M3.3 2.4c-.5 0-.9.4-.9.9 0 .2.1.4.2.6V4l3.2 3.2c.3.3.4.7.4 1v5.6c0 .4-.2.8-.4 1L2.6 18v.1c-.3.4-.3 1 .1 1.3.2.1.4.2.6.2.3 0 .5-.1.7-.3l3.2-3.1c.3-.3.7-.4 1-.4h5.7c.4 0 .8.2 1 .4l3.2 3.2h.1c.2.1.4.2.6.2.5 0 .9-.4.9-.9 0-.2-.1-.4-.2-.6l-3.2-3.2c-.3-.3-.4-.7-.4-1V8.2c0-.4.2-.8.4-1l3.1-3.1c.4-.3.5-.9.1-1.3-.2-.2-.4-.3-.7-.3-.2 0-.3.1-.5.1-.1 0-.1.1-.1.1L15 5.9c-.3.3-.7.4-1 .4H8.2c-.4 0-.8-.2-1-.4L3.9 2.7h-.1c-.1-.2-.3-.3-.5-.3',
  ],
  [
    '#00ffba',
    'M9.1 8H13c.6 0 1.1.5 1.1 1.1V13c0 .6-.5 1.1-1.1 1.1H9.1c-.6 0-1.1-.5-1.1-1.1V9.1C8 8.5 8.5 8 9.1 8',
  ],
  [
    '#ffffff',
    'M31.5 7h3C36 7 37 7.9 37 9.2c0 .8-.5 1.4-1.1 1.7.8.2 1.5.8 1.5 1.8 0 1.3-1.1 2.2-2.7 2.2h-3.2zm2.8 3.1c.5 0 .8-.4.8-.7 0-.4-.3-.7-.8-.7h-.9v1.5h.9zm.3 3.2c.5 0 .8-.3.8-.8s-.4-.8-.9-.8h-1.1v1.6zM47.5 11c0 2.3-1.7 4.1-4.1 4.1s-4.1-1.8-4.1-4.1 1.7-4.1 4.1-4.1 4.1 1.8 4.1 4.1m-6.3 0c0 1.3.8 2.3 2.1 2.3s2.1-1 2.1-2.3-.8-2.3-2.1-2.3c-1.2 0-2.1 1-2.1 2.3m9.7 0-2.4-3.9h2.2l1.4 2.5 1.5-2.5h2.2L53.4 11l2.4 3.9h-2.1l-1.5-2.5-1.5 2.5h-2.1zm6.8-4h5.2v1.7h-3.2v1.4h2.6v1.6h-2.6v1.5H63v1.7h-5.3zm7.6 0h1.9v6.1h3v1.7h-4.9z',
  ],
];

function boxelWordmark() {
  let svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 88 22');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Boxel');
  svg.setAttribute('class', 'oauth-wordmark');
  for (let [fill, d] of BOXEL_WORDMARK_PATHS) {
    let path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', fill);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// The account's avatar as the app draws it (boxel-ui's Avatar): the first
// letter of the user id on a color derived from it by the same formula, so
// the person sees the same avatar here as in the app.
function avatarColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);
  let hue = hash % 360;
  let saturation = 65 + (hash % 15);
  let rgb = (lightness) => {
    let c = ((1 - Math.abs((2 * lightness) / 100 - 1)) * saturation) / 100;
    let x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    let m = lightness / 100 - c / 2;
    let [r, g, b] =
      hue < 60
        ? [c, x, 0]
        : hue < 120
          ? [x, c, 0]
          : hue < 180
            ? [0, c, x]
            : hue < 240
              ? [0, x, c]
              : hue < 300
                ? [x, 0, c]
                : [c, 0, x];
    return [r, g, b].map((v) => Math.round((v + m) * 255));
  };
  let luminance = (channels) => {
    let [r, g, b] = channels.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let lightness = 50;
  let channels = rgb(lightness);
  while (lightness <= 100) {
    let l = luminance(channels);
    if ((l + 0.05) / 0.05 >= 4.5 || 1.05 / (l + 0.05) >= 4.5) {
      break;
    }
    lightness++;
    channels = rgb(lightness);
  }
  let text = (luminance(channels) + 0.05) / 0.05 >= 4.5 ? '#000000' : '#ffffff';
  return {
    background: `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    text,
  };
}

function avatar(userId, size) {
  let { background, text } = avatarColor(userId);
  let node = h(
    'span',
    { class: `oauth-avatar oauth-avatar--${size}`, 'aria-hidden': 'true' },
    userId.replace(/^@/, '').slice(0, 1).toUpperCase(),
  );
  node.style.setProperty('--oauth-avatar-bg', background);
  node.style.setProperty('--oauth-avatar-text', text);
  return node;
}

// Signs this window out and hands back to the flow that was showing, which
// then asks for a sign-in. Nothing reaches the application that asked.
async function switchAccount(onSwitch) {
  try {
    await signOut(readConfig());
  } catch {
    forgetSession();
  }
  onSwitch();
}

// The shell's own path: the stylesheet is served beside it.
function connectedAppsURL() {
  let sheet = document
    .querySelector('link[rel="stylesheet"]')
    ?.getAttribute('href');
  let base = sheet ? sheet.replace(/\/shell\.css$/, '') : '';
  return `${base}/?mode=connected-apps`;
}

// The square that stands for an application: its name's first letter on a
// hue chosen from its client id, so two applications with similar names
// still look different. Purely decorative.
function monogram(name, clientId) {
  let letter = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  let hue = 0;
  for (let char of String(clientId)) {
    hue = (hue * 31 + char.codePointAt(0)) % 360;
  }
  let mark = h('span', { class: 'oauth-mark', 'aria-hidden': 'true' }, letter);
  mark.style.setProperty('--oauth-mark-hue', String(hue));
  return mark;
}

// A realm URL as a person reads it: its last path segment as a name
// ("field-notes" → "Field Notes") and where it lives.
function describeRealm(realm) {
  try {
    let url = new URL(realm);
    let last = url.pathname.split('/').filter(Boolean).at(-1);
    let name = last
      ? decodeURIComponent(last)
          .replace(/[-_]+/g, ' ')
          .replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase())
      : url.host;
    return { name, where: `${url.host}${url.pathname.replace(/\/$/, '')}` };
  } catch {
    return { name: realm, where: '' };
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function connectedAgo(seconds) {
  let days = Math.floor((Date.now() / 1000 - seconds) / 86400);
  if (days <= 0) {
    return 'Connected today';
  }
  return days === 1 ? 'Connected yesterday' : `Connected ${days} days ago`;
}

function spinner() {
  return h('span', { class: 'oauth-spinner', 'aria-hidden': 'true' });
}

// An icon beside a title and an optional line of detail: one permission,
// the connection's duration, or an empty state.
function line(iconName, title, detail, attributes = {}) {
  return h(
    'li',
    { class: 'oauth-line', ...attributes },
    h('span', { class: 'oauth-line-icon' }, icon(iconName)),
    h(
      'span',
      { class: 'oauth-line-text' },
      h('span', { class: 'oauth-line-title' }, title),
      detail ? h('span', { class: 'oauth-line-detail' }, detail) : undefined,
    ),
  );
}

function permissionList(scopes) {
  let list = h('ul', { class: 'oauth-lines' });
  for (let scope of scopes) {
    if (scope === 'offline_access') {
      continue; // shown with the connection's duration instead
    }
    let copy = SCOPE_COPY[scope] ?? {
      icon: 'shield',
      title: `Other access: ${scope}`,
    };
    list.append(
      line(copy.icon, copy.title, copy.detail, {
        'data-caution': copy.caution,
      }),
    );
  }
  if (!scopes.includes('boxel:write')) {
    list.append(
      line('pencil-off', "Can't save changes to your cards", undefined, {
        'data-quiet': true,
      }),
    );
  }
  return list;
}

// The page around a card, laid out like the app's own top bar: the
// wordmark on the left, the account's avatar on the right opening its menu,
// and Boxel's own footer.
function page(root, card, session, onSwitch) {
  let menu;
  if (session) {
    let userId = String(session.user ?? '');
    let trigger = h(
      'button',
      {
        type: 'button',
        class: 'oauth-avatar-button',
        'aria-label': `Account: ${userId}`,
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
      },
      avatar(userId, 'small'),
    );
    let switchButton = h(
      'button',
      { type: 'button', class: 'oauth-pill' },
      'Switch account',
    );
    let signOutButton = h(
      'button',
      { type: 'button', class: 'oauth-pill oauth-pill--dark' },
      'Sign Out',
    );
    let popover = h(
      'div',
      {
        class: 'oauth-account-menu',
        role: 'dialog',
        'aria-label': 'Account',
        hidden: true,
      },
      h(
        'div',
        { class: 'oauth-account-menu-actions' },
        switchButton,
        signOutButton,
      ),
      h(
        'div',
        { class: 'oauth-account-menu-who' },
        avatar(userId, 'large'),
        h('span', { class: 'oauth-account-menu-id' }, userId),
      ),
      h(
        'a',
        { class: 'oauth-account-menu-link', href: connectedAppsURL() },
        'Connected applications',
        icon('chevron'),
      ),
    );
    let setOpen = (open) => {
      popover.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
    };
    trigger.addEventListener('click', () => setOpen(popover.hidden));
    let closeOnEscape = (event) => {
      if (event.key === 'Escape' && !popover.hidden) {
        setOpen(false);
        trigger.focus();
      }
    };
    trigger.addEventListener('keydown', closeOnEscape);
    popover.addEventListener('keydown', closeOnEscape);
    document.addEventListener('click', (event) => {
      if (!popover.hidden && !menu.contains(event.target)) {
        setOpen(false);
      }
    });
    for (let button of [switchButton, signOutButton]) {
      button.addEventListener('click', () => {
        switchButton.disabled = signOutButton.disabled = true;
        switchAccount(onSwitch);
      });
    }
    menu = h('div', { class: 'oauth-account' }, trigger, popover);
  }
  let year = new Date().getFullYear();
  root.replaceChildren(
    h(
      'div',
      { class: 'oauth-page' },
      h('header', { class: 'oauth-topbar' }, boxelWordmark(), menu),
      h('main', { class: 'oauth-main' }, card),
      h(
        'footer',
        { class: 'oauth-page-footer' },
        h(
          'nav',
          { 'aria-label': 'Boxel' },
          ...FOOTER_LINKS.map(([label, href]) =>
            h(
              'a',
              { href, target: '_blank', rel: 'noopener noreferrer' },
              label,
            ),
          ),
        ),
        h('p', {}, `© ${year} Composable Labs LLC`),
      ),
    ),
  );
}

function renderLoading(card, label) {
  card.setAttribute('aria-busy', 'true');
  card.replaceChildren(
    h('p', { class: 'oauth-status', role: 'status' }, spinner(), label),
    h(
      'div',
      { class: 'oauth-skeleton', 'aria-hidden': 'true' },
      h('span'),
      h('span'),
      h('span'),
    ),
  );
}

function renderProblem(card, title, message) {
  card.removeAttribute('aria-busy');
  let heading = h('h1', { class: 'oauth-title', tabindex: '-1' }, title);
  card.replaceChildren(
    h(
      'div',
      { class: 'oauth-problem' },
      h('span', { class: 'oauth-problem-icon' }, icon('alert')),
      heading,
      h('p', { class: 'oauth-muted' }, message),
    ),
  );
  heading.focus();
}

export async function oauthMode(root) {
  let config = readConfig();
  let session = storedSession();
  if (!session) {
    let uid = window.location.pathname.split('/').pop();
    renderSignIn(root, config, {
      client: 'window',
      resume: { oauthUid: uid },
      onSignedIn(signedIn) {
        storeSession(signedIn);
        oauthMode(root);
      },
    });
    return;
  }
  let card = h('section', {
    class: 'secure-card oauth',
    'aria-labelledby': 'oauth-title',
    'data-test-oauth-consent': '',
  });
  page(root, card, session, () => oauthMode(root));
  renderLoading(card, 'Loading the request…');

  let details;
  try {
    let response = await fetch(window.location.pathname, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      renderProblem(
        card,
        'This request has expired',
        'A request to connect lasts ten minutes. Go back to the application and connect again.',
      );
      return;
    }
    details = await response.json();
  } catch {
    renderProblem(
      card,
      "Boxel couldn't be reached",
      'Check your connection, then reload this page.',
    );
    return;
  }
  renderRequest(root, card, session, details);
}

function renderRequest(root, card, session, details) {
  card.removeAttribute('aria-busy');
  let isLogin = details.prompt === 'login';
  let clientName = String(details.clientName || 'Unnamed application');
  let clientId = String(details.clientId ?? '');
  let redirectHost = String(details.redirectHost ?? '');
  let scopes = Array.isArray(details.scopes) ? details.scopes.map(String) : [];
  let realms = Array.isArray(details.realms) ? details.realms.map(String) : [];
  let titleName =
    [...clientName].length > TITLE_NAME_LIMIT
      ? `${[...clientName].slice(0, TITLE_NAME_LIMIT).join('').trimEnd()}…`
      : clientName;

  let allowLabel = isLogin ? 'Continue' : 'Allow access';
  let allow = h(
    'button',
    {
      class: 'oauth-button oauth-button--approve',
      type: 'button',
      'data-test-oauth-allow': '',
    },
    allowLabel,
  );
  let deny = h(
    'button',
    {
      class: 'oauth-button oauth-button--quiet',
      type: 'button',
      'data-test-oauth-deny': '',
    },
    'Cancel',
  );
  let error = h('p', { class: 'oauth-error', role: 'alert' });
  let hint = h(
    'p',
    { class: 'oauth-hint', hidden: true },
    'Choose at least one workspace to allow access.',
  );

  // ── who is connecting, as whom ────────────────────────────────────────
  let title = h(
    'h1',
    { id: 'oauth-title', class: 'oauth-title', tabindex: '-1' },
    isLogin ? 'Continue to ' : undefined,
    h('span', { class: 'oauth-client-name' }, titleName),
    isLogin ? undefined : ' wants to use your Boxel account',
  );
  let handshake = h(
    'div',
    { class: 'oauth-handshake', 'aria-hidden': 'true' },
    monogram(clientName, clientId),
    h('span', { class: 'oauth-handshake-link' }, icon('arrows')),
    boxelMark(),
  );
  // The host it returns to is the one fact about the application Boxel has
  // checked, so it sits with the name; the name itself is self-chosen.
  let identity = h(
    'p',
    { class: 'oauth-identity' },
    h(
      'span',
      { class: 'oauth-host' },
      icon('arrows'),
      h('span', { class: 'oauth-visually-hidden' }, 'Returns to '),
      h('span', { class: 'oauth-mono' }, redirectHost),
    ),
    h('span', { class: 'oauth-chip', 'data-caution': true }, 'Unverified'),
  );
  let parts = [
    h('header', { class: 'oauth-header' }, handshake, title, identity),
    h(
      'p',
      { class: 'oauth-note' },
      'Applications choose their own names, and Boxel hasn’t verified this one. Continue only if you started this from ',
      h('span', { class: 'oauth-mono' }, redirectHost),
      '.',
    ),
    h(
      'details',
      { class: 'oauth-details' },
      h('summary', {}, 'Application details'),
      h(
        'dl',
        { class: 'oauth-facts' },
        h('dt', {}, 'Name'),
        h('dd', {}, clientName),
        h('dt', {}, 'Returns to'),
        h('dd', { class: 'oauth-mono' }, redirectHost),
        h('dt', {}, 'Through'),
        h(
          'dd',
          {},
          String(details.resourceName ?? ''),
          h(
            'span',
            { class: 'oauth-mono oauth-muted' },
            ` · ${hostOf(String(details.resource ?? ''))}`,
          ),
        ),
        h('dt', {}, 'Client ID'),
        h('dd', { class: 'oauth-mono oauth-muted' }, clientId),
      ),
    ),
  ];

  if (isLogin) {
    let userId = String(session.user ?? '');
    let switchLink = h(
      'button',
      { type: 'button', class: 'oauth-link' },
      'Switch',
    );
    switchLink.addEventListener('click', () => {
      switchLink.disabled = true;
      switchAccount(() => oauthMode(root));
    });
    parts.push(
      h(
        'div',
        { class: 'oauth-whoami' },
        avatar(userId, 'medium'),
        h('span', { class: 'oauth-whoami-id oauth-mono' }, userId),
        switchLink,
      ),
      h(
        'p',
        { class: 'oauth-note oauth-note--center' },
        'Continuing signs it in with this Boxel account. Not the right account? Switch first.',
      ),
    );
  }

  let choices = [];
  let remember;
  let updateSelection = () => {};
  if (!isLogin) {
    // ── what it may do ──────────────────────────────────────────────────
    parts.push(
      h(
        'section',
        { class: 'oauth-section', 'aria-labelledby': 'oauth-can' },
        h('h2', { id: 'oauth-can' }, 'It will be able to'),
        permissionList(scopes),
      ),
    );

    // ── where ───────────────────────────────────────────────────────────
    let count = h('span', { class: 'oauth-count', 'aria-live': 'polite' });
    let list = h('div', { class: 'oauth-realms' });
    for (let realm of realms) {
      let { name, where } = describeRealm(realm);
      let checkbox = h('input', {
        type: 'checkbox',
        value: realm,
        class: 'oauth-check',
      });
      // Nothing starts chosen: the user picks each workspace to share.
      checkbox.checked = false;
      checkbox.addEventListener('change', () => updateSelection());
      choices.push(checkbox);
      list.append(
        h(
          'label',
          { class: 'oauth-option' },
          checkbox,
          h(
            'span',
            { class: 'oauth-line-text' },
            h('span', { class: 'oauth-line-title' }, name),
            h('span', { class: 'oauth-line-detail oauth-mono' }, where),
          ),
        ),
      );
    }
    parts.push(
      h(
        'fieldset',
        { class: 'oauth-section' },
        h(
          'legend',
          {},
          'Workspaces it can use',
          realms.length > 1 ? count : undefined,
        ),
        list,
      ),
    );
    updateSelection = () => {
      let selected = choices.filter((input) => input.checked).length;
      count.textContent = `${selected} of ${choices.length}`;
      allow.disabled = selected === 0;
      hint.hidden = selected !== 0;
      hint.textContent = selected
        ? ''
        : 'Choose at least one workspace to allow access.';
    };

    // ── how long ────────────────────────────────────────────────────────
    let until = formatDate(new Date(Date.now() + RENEWAL_DAYS * 86400 * 1000));
    let duration;
    if (scopes.includes('offline_access')) {
      duration = h(
        'ul',
        { class: 'oauth-lines' },
        line(
          'clock',
          `Stays connected for up to ${RENEWAL_DAYS} days`,
          `Access renews automatically until ${until} at the latest. You can revoke it any time in Connected applications.`,
        ),
      );
    } else if (details.canRefresh) {
      // Renewal is a decision of its own, and starts off.
      remember = h('input', {
        type: 'checkbox',
        class: 'oauth-check',
        'aria-describedby': 'oauth-remember-detail',
      });
      remember.checked = false;
      duration = h(
        'label',
        { class: 'oauth-option' },
        remember,
        h(
          'span',
          { class: 'oauth-line-text' },
          h(
            'span',
            { class: 'oauth-line-title' },
            `Keep it connected for up to ${RENEWAL_DAYS} days`,
          ),
          h(
            'span',
            { class: 'oauth-line-detail', id: 'oauth-remember-detail' },
            `Access renews automatically until ${until} at the latest, and you can revoke it any time in Connected applications. Left off, access ends after ${ACCESS_MINUTES} minutes and the application has to ask again.`,
          ),
        ),
      );
    } else {
      duration = h(
        'ul',
        { class: 'oauth-lines' },
        line(
          'clock',
          `Access lasts ${ACCESS_MINUTES} minutes`,
          'After that, the application has to ask again.',
        ),
      );
    }
    parts.push(
      h(
        'section',
        { class: 'oauth-section', 'aria-labelledby': 'oauth-how-long' },
        h('h2', { id: 'oauth-how-long' }, 'For how long'),
        duration,
      ),
    );
  }

  // ── the decision ──────────────────────────────────────────────────────
  parts.push(
    h(
      'footer',
      { class: 'oauth-footer' },
      error,
      hint,
      h('div', { class: 'oauth-actions' }, deny, allow),
      h(
        'p',
        { class: 'oauth-footnote' },
        'Cancel returns you to ',
        h('span', { class: 'oauth-mono' }, redirectHost),
        ' without sharing anything.',
      ),
    ),
  );

  let setBusy = (button, label) => {
    let busy = Boolean(label);
    allow.disabled = deny.disabled = busy;
    for (let input of [...choices, remember]) {
      if (input) {
        input.disabled = busy;
      }
    }
    card.toggleAttribute('aria-busy', busy);
    if (busy) {
      button.replaceChildren(spinner(), label);
    } else {
      allow.replaceChildren(allowLabel);
      deny.replaceChildren('Cancel');
      updateSelection();
    }
  };

  let submit = async (decision) => {
    error.textContent = '';
    if (decision === 'allow') {
      setBusy(allow, isLogin ? 'Continuing…' : 'Allowing…');
    } else {
      setBusy(deny, 'Cancelling…');
    }
    try {
      let answer = await fetch(window.location.pathname, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          decision,
          ...(remember ? { remember: remember.checked } : {}),
          realms: choices
            .filter((input) => input.checked)
            .map((input) => input.value),
        }),
      });
      if (!answer.ok) {
        if (answer.status === 401) {
          forgetSession();
          oauthMode(root);
          return;
        }
        throw new Error(
          answer.status === 403
            ? 'Access couldn’t be allowed. Your account may no longer have access to a workspace you chose, or this request began with a different Boxel account. Change your choice, or start again from the application.'
            : 'Access couldn’t be allowed. Go back to the application and start again.',
        );
      }
      let { redirectTo } = await answer.json();
      // Only navigate to the provider's own resume endpoint. It validates
      // the registered client redirect before issuing an OAuth code.
      let target = new URL(redirectTo, window.location.origin);
      if (
        target.origin !== window.location.origin ||
        !target.pathname.startsWith('/oauth/authorize/')
      ) {
        throw new Error('Boxel sent an unexpected response. Start again.');
      }
      card.replaceChildren(
        h(
          'p',
          { class: 'oauth-status', role: 'status' },
          spinner(),
          'Returning to ',
          h('span', { class: 'oauth-mono' }, redirectHost),
          '…',
        ),
      );
      window.location.assign(target.href);
    } catch (e) {
      setBusy(null);
      error.textContent =
        e instanceof TypeError
          ? 'Boxel couldn’t be reached. Check your connection and try again.'
          : e.message;
    }
  };
  allow.addEventListener('click', () => submit('allow'));
  deny.addEventListener('click', () => submit('deny'));

  card.replaceChildren(...parts);
  updateSelection();
  // Focus the request itself, not the approve button, so a stray Enter
  // can't grant access and a screen reader starts with who is asking.
  title.focus();
}

export async function oauthGrantsMode(root) {
  let config = readConfig();
  let session = storedSession();
  if (!session) {
    renderSignIn(root, config, {
      client: 'window',
      resume: { mode: 'connected-apps' },
      onSignedIn(value) {
        storeSession(value);
        oauthGrantsMode(root);
      },
    });
    return;
  }
  let card = h('section', {
    class: 'secure-card oauth',
    'aria-labelledby': 'oauth-title',
  });
  page(root, card, session, () => oauthGrantsMode(root));
  renderLoading(card, 'Loading connected applications…');
  let grants;
  try {
    let response = await fetch('/oauth/grants', {
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
    });
    if (response.status === 401) {
      forgetSession();
      oauthGrantsMode(root);
      return;
    }
    if (!response.ok) {
      throw new Error();
    }
    grants = await response.json();
  } catch {
    renderProblem(
      card,
      'Connected applications couldn’t load',
      'Check your connection, then reload this page.',
    );
    return;
  }
  card.removeAttribute('aria-busy');
  let error = h('p', { class: 'oauth-error', role: 'alert' });
  let list = h('ul', { class: 'oauth-grants' });
  if (!grants.length) {
    list.append(
      line(
        'shield',
        'No applications are connected',
        'An application you allow to use your Boxel account appears here, and you can revoke its access at any time.',
        { 'data-quiet': true },
      ),
    );
  }
  for (let grant of grants) {
    list.append(grantRow(root, grant, error));
  }
  card.replaceChildren(
    h(
      'header',
      { class: 'oauth-header oauth-header--page' },
      h(
        'h1',
        { id: 'oauth-title', class: 'oauth-title' },
        'Connected applications',
      ),
      h(
        'p',
        { class: 'oauth-muted' },
        'Applications you’ve allowed to use your Boxel account. Revoking access stops one at once.',
      ),
    ),
    list,
    error,
  );
}

function grantRow(root, grant, error) {
  let clientId = String(grant.client_id ?? '');
  let name = String(grant.client_name || clientId);
  let scopes = Array.isArray(grant.scopes) ? grant.scopes.map(String) : [];
  let realms = Array.isArray(grant.realms) ? grant.realms.map(String) : [];

  let access = h('ul', { class: 'oauth-chips', 'aria-label': 'Access' });
  for (let scope of scopes) {
    if (SCOPE_CHIPS[scope]) {
      access.append(
        h(
          'li',
          {
            class: 'oauth-chip',
            'data-caution': scope === 'boxel:write',
          },
          SCOPE_CHIPS[scope],
        ),
      );
    }
  }
  let workspaces = h('ul', {
    class: 'oauth-chips',
    'aria-label': 'Workspaces',
  });
  for (let realm of realms) {
    let { name: realmName, where } = describeRealm(realm);
    workspaces.append(
      h(
        'li',
        { class: 'oauth-chip oauth-chip--realm', title: where },
        realmName,
      ),
    );
  }
  let renewsUntil = Number(grant.renewable_until) * 1000;
  let renewal = !grant.renewable_until
    ? 'Doesn’t renew'
    : renewsUntil > Date.now()
      ? `Renews until ${formatDate(new Date(renewsUntil))}`
      : 'Renewal ended';
  let meta = [
    grant.issued_at ? connectedAgo(Number(grant.issued_at)) : undefined,
    renewal,
  ]
    .filter(Boolean)
    .join(' · ');

  let host = grant.client_host ? String(grant.client_host) : undefined;
  let revoke = h(
    'button',
    { type: 'button', class: 'oauth-button oauth-button--danger' },
    'Revoke',
  );
  let keep = h(
    'button',
    { type: 'button', class: 'oauth-button oauth-button--quiet' },
    'Keep',
  );
  let confirmRevoke = h(
    'button',
    { type: 'button', class: 'oauth-button oauth-button--destructive' },
    'Revoke access',
  );
  // A second, explicit step, so one stray click can't disconnect.
  let confirm = h(
    'div',
    {
      class: 'oauth-confirm',
      role: 'group',
      'aria-label': `Revoke access for ${name}`,
      hidden: true,
    },
    h(
      'span',
      { class: 'oauth-confirm-text' },
      'Revoke access? It stops working right away.',
    ),
    keep,
    confirmRevoke,
  );
  let row;
  let setConfirming = (on) => {
    confirm.hidden = !on;
    revoke.hidden = on;
    row.toggleAttribute('data-confirming', on);
    (on ? keep : revoke).focus();
  };
  revoke.addEventListener('click', () => setConfirming(true));
  keep.addEventListener('click', () => setConfirming(false));
  confirmRevoke.addEventListener('click', async () => {
    confirmRevoke.disabled = keep.disabled = true;
    confirmRevoke.replaceChildren(spinner(), 'Revoking…');
    error.textContent = '';
    try {
      let answer = await fetch('/oauth/grants', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storedSession()?.token}`,
        },
        body: JSON.stringify({ id: grant.id }),
      });
      if (!answer.ok) {
        throw new Error();
      }
      oauthGrantsMode(root);
    } catch {
      error.textContent = `Access for ${name} couldn’t be revoked. Try again.`;
      confirmRevoke.disabled = keep.disabled = false;
      confirmRevoke.replaceChildren('Revoke access');
    }
  });

  row = h(
    'li',
    { class: 'oauth-grant' },
    h(
      'div',
      { class: 'oauth-grant-main' },
      monogram(name, clientId),
      h(
        'div',
        { class: 'oauth-grant-body' },
        h('h2', { class: 'oauth-grant-name' }, name),
        h(
          'p',
          { class: 'oauth-muted oauth-small' },
          host ? h('span', { class: 'oauth-mono' }, host) : undefined,
          host ? ' · ' : undefined,
          meta,
        ),
        access,
        workspaces,
      ),
      revoke,
    ),
    confirm,
  );
  return row;
}
