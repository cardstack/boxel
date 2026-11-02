import type { Realm } from '@cardstack/runtime-common';

import type { RealmRoutingDeps } from './realm-routing.ts';
import { sitePaths } from './host-routes.ts';

// The files a site serves at its root from its settings: `sitemap.xml`,
// `robots.txt` and `llms.txt`. Nothing is stored; each is written from the
// site's page types when asked for.

// The sitemap protocol's limit per file. A larger site's sitemap.xml is an
// index of `sitemap.xml?part=N` files.
export const SITEMAP_MAX_URLS = 50_000;

export const SITE_FILES = ['sitemap.xml', 'robots.txt', 'llms.txt'] as const;
export type SiteFileName = (typeof SITE_FILES)[number];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// The site's address on the host the request came in on, with a trailing
// slash, and an address on it for a realm-relative path.
function addressOn(mount: URL) {
  return (path: string) => new URL(path.replace(/^\//, ''), mount).href;
}

export async function siteFile(
  name: SiteFileName,
  realm: Realm,
  mount: URL,
  params: URLSearchParams,
  deps: RealmRoutingDeps,
): Promise<{ contentType: string; body: string } | undefined> {
  let settings = await realm.getSiteSettings();
  if (!settings.pageTypes.length && !settings.notFound && !settings.frame) {
    return undefined;
  }
  let at = addressOn(mount);

  if (name === 'robots.txt') {
    let lines: string[] = [];
    for (let crawler of settings.crawlers) {
      lines.push(
        `User-agent: ${crawler.userAgent}`,
        crawler.allow ? 'Allow: /' : 'Disallow: /',
        '',
      );
    }
    lines.push(
      'User-agent: *',
      settings.listed ? 'Allow: /' : 'Disallow: /',
      '',
    );
    if (settings.listed) {
      lines.push(`Sitemap: ${at('/sitemap.xml')}`);
    }
    return {
      contentType: 'text/plain; charset=utf-8',
      body: `${lines.join('\n')}\n`,
    };
  }

  if (name === 'llms.txt') {
    // https://llmstxt.org: a title, a summary, then sections of links. A
    // catalog's every page is in the sitemap; this lists where to start.
    let info = await realm.getRealmInfo();
    let lines = [`# ${info.name}`, ''];
    if (settings.tagline) {
      lines.push(`> ${settings.tagline}`, '');
    }
    let starts = settings.pageTypes.filter((t) => t.listingPath);
    if (starts.length) {
      lines.push('## Sections', '');
      for (let pageType of starts) {
        lines.push(
          `- [${pageType.listingTitle ?? pageType.name}](${at(pageType.listingPath!)})`,
        );
      }
      lines.push('');
    }
    lines.push('## Optional', '', `- [Every page](${at('/sitemap.xml')})`, '');
    return {
      contentType: 'text/markdown; charset=utf-8',
      body: lines.join('\n'),
    };
  }

  // sitemap.xml
  let part = Number(params.get('part') ?? '0');
  if (!Number.isInteger(part) || part < 0) {
    return undefined;
  }
  if (part === 0) {
    let { paths, total } = await sitePaths(realm, deps, {
      take: SITEMAP_MAX_URLS,
    });
    if (total > SITEMAP_MAX_URLS) {
      let parts = Math.ceil(total / SITEMAP_MAX_URLS);
      let entries = Array.from(
        { length: parts },
        (_, i) =>
          `  <sitemap><loc>${xmlEscape(`${at('/sitemap.xml')}?part=${i + 1}`)}</loc></sitemap>`,
      );
      return {
        contentType: 'application/xml; charset=utf-8',
        body: `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`,
      };
    }
    return urlset(paths, at);
  }
  let { paths } = await sitePaths(realm, deps, {
    skip: (part - 1) * SITEMAP_MAX_URLS,
    take: SITEMAP_MAX_URLS,
  });
  if (!paths.length) {
    return undefined;
  }
  return urlset(paths, at);
}

function urlset(paths: string[], at: (path: string) => string) {
  let entries = paths.map(
    (path) => `  <url><loc>${xmlEscape(at(path))}</loc></url>`,
  );
  return {
    contentType: 'application/xml; charset=utf-8',
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`,
  };
}
