import { createHash } from 'crypto';
import type Koa from 'koa';
import type { Readable } from 'stream';
import { readRequestText, setRequestText } from '../middleware/index.ts';
import { nodeStreamToText } from '../stream.ts';
import { requestHostURL, type HostURLMatch } from './realm-host-urls.ts';

// The one place a request on a host URL and its response are translated
// between the host URL and the realm's URL (ADR 033 §1.5). Everything stored
// stays canonical (ADR 002): the realm reads and writes its own URL, and a
// visitor sees only the host URL they came in on.
//
// `resolveHostURLs` has already made the request's path name the realm's URL.
// On the way in this translates the rest of the request: its query string and
// its JSON body, so that card ids and code refs in a `_search`, an
// `_operations` or a `_capabilities` request name the realm's URL. On the way
// out it translates every response header, and the body of an HTML or JSON
// response. Both the realm's URL and its canonical host URL are translated to
// the host URL the request came in on, so a page is right whichever of the
// two its stored markup names. A page's canonical link and `og:url` name the
// canonical host URL instead (ADR 033 §1.4).
//
// Nothing translated is stored. A file's stored bytes, as a card-source read
// serves them, are answered untranslated, so that a client which writes the
// file back writes what the realm holds.
//
// A translated response is a different representation from the realm's, and
// it changes when the canonical host URL changes, which the realm's ETag does
// not see. So every ETag on a host URL carries a suffix that names the
// translation, and a conditional request has the suffix removed before the
// realm compares it. A validator with another suffix, or none, never matches.

// A request whose body names ids: JSON, JSON:API and the operations envelope.
function isJSONType(contentType: string): boolean {
  let type = contentType.split(';')[0].trim().toLowerCase();
  return type === 'application/json' || type.endsWith('+json');
}

const CARD_SOURCE = 'application/vnd.card+source';

// The card+html and file-meta+html reads: JSON documents that carry markup,
// a `head` rendering's canonical link and `og:url` among it.
function isMarkupEnvelopeType(type: string): boolean {
  return type.endsWith('+html');
}

// The response types whose bodies are translated.
function isTranslatedResponseType(type: string): boolean {
  return (
    type === 'text/html' ||
    type === 'application/json' ||
    type.endsWith('+json') ||
    type.endsWith('+html')
  );
}

const CONFIG_META =
  /^(<meta name="@cardstack\/host\/config\/environment" content=")([^"]*)("[^>]*>)$/;
const LINK_OR_META = /<(?:link|meta)\b[^>]*>/gi;
const CANONICAL_TAG =
  /\brel\s*=\s*["']?[^"'>]*\bcanonical\b|\bproperty\s*=\s*["']?og:url["'\s/>]/i;

const ENTITY_TAG = /(W\/)?"([^"]*)"/g;
const CONDITIONAL_HEADERS = ['if-match', 'if-none-match', 'if-range'];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces each key of `pairs` with its value in one pass, longest key first,
// so that no replacement is translated again.
class Replacer {
  #pairs: Map<string, string>;
  #pattern: RegExp | undefined;

  constructor(pairs: [string, string][]) {
    this.#pairs = new Map();
    for (let [from, to] of pairs) {
      if (from !== to && !this.#pairs.has(from)) {
        this.#pairs.set(from, to);
        // The same URL inside a query string or the encoded config.
        this.#pairs.set(encodeURIComponent(from), encodeURIComponent(to));
      }
    }
    let keys = [...this.#pairs.keys()].sort((a, b) => b.length - a.length);
    this.#pattern = keys.length
      ? new RegExp(keys.map(escapeRegExp).join('|'), 'g')
      : undefined;
  }

  replace(text: string): string {
    if (!this.#pattern) {
      return text;
    }
    return text.replace(this.#pattern, (match) => this.#pairs.get(match)!);
  }
}

export class HostURLTranslator {
  readonly match: HostURLMatch;
  #inbound: Replacer;
  #outbound: Replacer;
  #canonical: Replacer;
  #realmPath: string;
  #hostPath: string;
  #validatorSuffix: string;

  constructor(match: HostURLMatch) {
    this.match = match;
    let { hostURL, realmURL } = match;
    let canonicalHostURL = match.canonicalHostURL ?? hostURL;
    this.#inbound = new Replacer([
      [hostURL, realmURL],
      [canonicalHostURL, realmURL],
    ]);
    this.#outbound = new Replacer([
      [realmURL, hostURL],
      [canonicalHostURL, hostURL],
    ]);
    this.#canonical = new Replacer([
      [realmURL, canonicalHostURL],
      [hostURL, canonicalHostURL],
    ]);
    this.#realmPath = new URL(realmURL).pathname;
    this.#hostPath = new URL(hostURL).pathname;
    let hash = createHash('sha256')
      .update(`${realmURL}\n${hostURL}\n${canonicalHostURL}`)
      .digest('base64url')
      .slice(0, 12);
    this.#validatorSuffix = `.h${hash}`;
  }

  // The realm's ETag, as the ETag of this translation of it.
  outboundETag(value: string): string {
    return value.replace(
      ENTITY_TAG,
      (_match, weak: string | undefined, tag: string) =>
        `${weak ?? ''}"${tag}${this.#validatorSuffix}"`,
    );
  }

  // A conditional header's entity tags, as the realm's own. A tag from
  // another translation keeps a mark that matches no realm ETag.
  inboundConditional(value: string): string {
    return value.replace(
      ENTITY_TAG,
      (_match, weak: string | undefined, tag: string) => {
        let realmTag = tag.endsWith(this.#validatorSuffix)
          ? tag.slice(0, -this.#validatorSuffix.length)
          : `${tag}.stale`;
        return `${weak ?? ''}"${realmTag}"`;
      },
    );
  }

  // Text from a visitor, with the host URLs it names as the realm's URL.
  inbound(text: string): string {
    return this.#inbound.replace(text);
  }

  // Text bound for a visitor, with the realm's URL and its canonical host URL
  // as the host URL the request came in on.
  outbound(text: string): string {
    return this.#outbound.replace(text);
  }

  // A path below the realm's URL, as the same path below the host URL.
  // Any other path is returned as it is.
  outboundPath(path: string): string {
    if (path.startsWith(this.#realmPath)) {
      return `${this.#hostPath}${path.slice(this.#realmPath.length)}`;
    }
    if (`${path}/` === this.#realmPath) {
      return this.#hostPath.replace(/\/$/, '') || '/';
    }
    return path;
  }

  outboundHeader(name: string, value: string): string {
    let lowerName = name.toLowerCase();
    if (lowerName === 'etag') {
      return this.outboundETag(value);
    }
    if (lowerName === 'location' && value.startsWith('/')) {
      return this.outboundPath(value);
    }
    return this.outbound(value);
  }

  // A served page. The canonical link and `og:url` name the canonical host
  // URL, and the host app's config is translated as data, since its routing
  // map names paths as well as URLs.
  outboundHTML(html: string): string {
    let out = '';
    let last = 0;
    for (let tag of html.matchAll(LINK_OR_META)) {
      out += this.outbound(html.slice(last, tag.index));
      out += this.#outboundTag(tag[0]);
      last = tag.index + tag[0].length;
    }
    return out + this.outbound(html.slice(last));
  }

  outboundBody(text: string, type: string): string {
    if (type === 'text/html') {
      return this.outboundHTML(text);
    }
    if (isMarkupEnvelopeType(type)) {
      return this.#outboundMarkupEnvelope(text);
    }
    return this.outbound(text);
  }

  // Each string in the document is translated as markup, so a `head`
  // rendering's canonical link and `og:url` name the canonical host URL.
  #outboundMarkupEnvelope(text: string): string {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return this.outbound(text);
    }
    let walk = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return this.outboundHTML(value);
      }
      if (Array.isArray(value)) {
        return value.map(walk);
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            this.outbound(key),
            walk(child),
          ]),
        );
      }
      return value;
    };
    return JSON.stringify(walk(doc));
  }

  #outboundTag(tag: string): string {
    let config = CONFIG_META.exec(tag);
    if (config) {
      let [, open, content, close] = config;
      return `${open}${encodeURIComponent(this.#outboundConfig(content))}${close}`;
    }
    if (CANONICAL_TAG.test(tag)) {
      return this.#canonical.replace(tag);
    }
    return this.outbound(tag);
  }

  #outboundConfig(encoded: string): string {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(this.outbound(decodeURIComponent(encoded)));
    } catch {
      return this.outbound(decodeURIComponent(encoded));
    }
    // The routing map names each route by its path below the server's root,
    // which is the realm's path on the realm's URL.
    if (Array.isArray(config.hostRoutingMap)) {
      config.hostRoutingMap = config.hostRoutingMap.map((rule: unknown) => {
        if (!rule || typeof rule !== 'object') {
          return rule;
        }
        let translated = { ...(rule as Record<string, unknown>) };
        for (let key of ['path', 'redirectTo']) {
          let value = translated[key];
          if (typeof value === 'string' && value.startsWith('/')) {
            translated[key] = this.outboundPath(value);
          }
        }
        return translated;
      });
    }
    return JSON.stringify(config);
  }
}

async function responseText(body: unknown): Promise<string | undefined> {
  if (typeof body === 'string') {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }
  if (body && typeof (body as Readable).pipe === 'function') {
    return await nodeStreamToText(body as Readable);
  }
  if (body && typeof body === 'object') {
    return JSON.stringify(body);
  }
  return undefined;
}

// Translates a request on a host URL and its response. Runs right after
// `resolveHostURLs`, so it is the outermost code that sees the request in the
// realm's terms.
export function translateAtHostURLs(): (
  ctxt: Koa.Context,
  next: Koa.Next,
) => Promise<void> {
  return async function translateAtHostURL(ctxt, next) {
    let match = requestHostURL(ctxt);
    if (!match) {
      await next();
      return;
    }
    let translator = new HostURLTranslator(match);

    // Inbound.
    let headers = ctxt.req.headers as Record<string, string | undefined>;
    for (let name of CONDITIONAL_HEADERS) {
      let value = headers[name];
      if (typeof value === 'string') {
        headers[name] = translator.inboundConditional(value);
      }
    }
    let querystring = ctxt.querystring;
    if (querystring) {
      let translated = translator.inbound(querystring);
      if (translated !== querystring) {
        ctxt.querystring = translated;
        ctxt.originalUrl = ctxt.url;
      }
    }
    if (
      ['POST', 'PATCH', 'PUT', 'QUERY', 'DELETE'].includes(ctxt.method) &&
      isJSONType(ctxt.get('content-type'))
    ) {
      let body = await readRequestText(ctxt);
      let translated = translator.inbound(body);
      if (translated !== body) {
        setRequestText(ctxt, translated);
      }
    }

    await next();

    // Outbound.
    for (let [name, value] of Object.entries(ctxt.response.headers)) {
      if (typeof value === 'string') {
        let translated = translator.outboundHeader(name, value);
        if (translated !== value) {
          ctxt.set(name, translated);
        }
      }
    }
    let type = ctxt.response.type;
    if (
      ctxt.method === 'HEAD' ||
      ctxt.status === 206 ||
      ctxt.body == null ||
      !isTranslatedResponseType(type) ||
      // A card-source read answers with the file's own content type, so it
      // is known by what the request asked for. Its errors are translated.
      (ctxt.get('accept').toLowerCase().includes(CARD_SOURCE) &&
        ctxt.status >= 200 &&
        ctxt.status < 300) ||
      // Koa reads an absent header as ''. A compressed body can't be read as
      // text here.
      !['', 'identity'].includes(ctxt.response.get('content-encoding'))
    ) {
      return;
    }
    let text = await responseText(ctxt.body);
    if (text === undefined) {
      return;
    }
    let translated = translator.outboundBody(text, type);
    if (translated !== text || typeof ctxt.body !== 'string') {
      // Content-Type is already set, so assigning a string keeps it and sets
      // the new length.
      ctxt.body = translated;
    }
  };
}
