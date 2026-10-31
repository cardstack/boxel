import {
  normalizeRoutingPath,
  type HostRouteShare,
} from '@cardstack/runtime-common';

// Rewrites a page on the way out to the address it is served at. A card can
// appear on several sites, so its prerendered HTML never holds a site's
// paths: links to cards, the canonical URL and og:url are set here, per
// request, for the host URL the visitor came in on (Host Mode v2 D7, D15).
//
// - A link to a card the site routes points at that card's path, on the
//   request's own host and mount.
// - A link marked with a site path (`data-boxel-card-link="/shop"`, which
//   `<CardLink @path>` writes) points at that path on the request's host and
//   mount. A card prerenders without knowing where a site mounts it, so this is
//   how its links to listings and other non-card pages get real addresses.
// - The page's canonical link and og:url name the same path on the
//   request's host. Host Mode v2 names the canonical host URL in its own
//   mapping, which only the realm's owner sets.

export interface SiteRewriter {
  body(html: string, documentBase: URL): string;
  head(html: string): string;
}

export function cardKey(url: URL): string {
  let key = new URL(url.href);
  key.hash = '';
  key.search = '';
  return key.href.replace(/\.json$/, '');
}

export function siteRewriter(opts: {
  // Where the routing realm is mounted on the host the request came in on:
  // 'https://shop.example/' or 'https://space.example/fairway-shop/'.
  requestMount: URL;
  // Where the canonical link and og:url point: the owner's chosen host URL
  // for the site. The request's mount when not given.
  canonicalMount?: URL;
  // The request's path, relative to the realm's mount: '/shop/driver'.
  requestPath: string;
  // Where the site serves each linked card, by card key.
  paths: Map<string, string>;
  // How this page looks when shared, from its page type: each value set
  // replaces the card's own og tag.
  share?: HostRouteShare;
  // False for a page that answers 404: a missing address has no canonical
  // form to point a search engine at.
  canonical?: boolean;
  document: Document;
}): SiteRewriter {
  let { requestMount, requestPath, document } = opts;
  let canonicalMount = opts.canonicalMount ?? requestMount;
  let pathByCard = opts.paths;
  let at = (mount: URL, path: string) =>
    new URL(path.replace(/^\//, ''), mount).href;

  return {
    body(html, documentBase) {
      if (
        !html.includes('href') ||
        (!pathByCard.size && !html.includes('data-boxel-card-link'))
      ) {
        return html;
      }
      let template = document.createElement('template');
      template.innerHTML = html;
      for (let anchor of template.content.querySelectorAll('a[href]')) {
        let sitePath = anchor.getAttribute('data-boxel-card-link');
        if (sitePath?.startsWith('/') && !sitePath.startsWith('//')) {
          let [path, hash] = sitePath.split('#');
          anchor.setAttribute(
            'href',
            at(requestMount, path) + (hash ? `#${hash}` : ''),
          );
          continue;
        }
        let href = anchor.getAttribute('href')!;
        // A link within the page itself stays as written.
        if (href.startsWith('#') || href.startsWith('?')) {
          continue;
        }
        let url: URL;
        try {
          url = new URL(href, documentBase);
        } catch {
          continue;
        }
        let path = pathByCard.get(cardKey(url));
        if (path) {
          anchor.setAttribute('href', at(requestMount, path) + url.hash);
        }
      }
      return template.innerHTML;
    },

    head(html) {
      let template = document.createElement('template');
      template.innerHTML = html;
      for (let stale of template.content.querySelectorAll(
        'link[rel~="canonical"], meta[property="og:url"]',
      )) {
        stale.remove();
      }
      if (opts.canonical !== false) {
        let canonical = at(canonicalMount, normalizeRoutingPath(requestPath));
        let link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        link.setAttribute('href', canonical);
        let og = document.createElement('meta');
        og.setAttribute('property', 'og:url');
        og.setAttribute('content', canonical);
        template.content.append(link, og);
      }

      let share = opts.share;
      let setMeta = (
        attribute: 'property' | 'name',
        key: string,
        value: string,
      ) => {
        for (let stale of template.content.querySelectorAll(
          `meta[${attribute}="${key}"]`,
        )) {
          stale.remove();
        }
        let meta = document.createElement('meta');
        meta.setAttribute(attribute, key);
        meta.setAttribute('content', value);
        template.content.append(meta);
      };
      if (share?.title) {
        setMeta('property', 'og:title', share.title);
        setMeta('name', 'twitter:title', share.title);
      }
      if (share?.description) {
        setMeta('property', 'og:description', share.description);
        setMeta('name', 'description', share.description);
        setMeta('name', 'twitter:description', share.description);
      }
      if (share?.image) {
        setMeta('property', 'og:image', share.image);
        setMeta('name', 'twitter:image', share.image);
        setMeta('name', 'twitter:card', 'summary_large_image');
      }
      return template.innerHTML;
    },
  };
}

// The cards a page's HTML links to, as card keys: every anchor whose target
// resolves to an http(s) URL. The rewriter asks the site where each is
// served, in one batch.
export function linkedCards(
  html: string,
  documentBase: URL,
  document: Document,
): string[] {
  if (!html.includes('href')) {
    return [];
  }
  let template = document.createElement('template');
  template.innerHTML = html;
  let keys = new Set<string>();
  for (let anchor of template.content.querySelectorAll('a[href]')) {
    let href = anchor.getAttribute('href')!;
    if (href.startsWith('#') || href.startsWith('?')) {
      continue;
    }
    try {
      let url = new URL(href, documentBase);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        keys.add(cardKey(url));
      }
    } catch {
      // not a URL
    }
  }
  return [...keys];
}
