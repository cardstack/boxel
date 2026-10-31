import type { TemplateOnlyComponent } from '@ember/component/template-only';
import GlimmerComponent from '@glimmer/component';

import {
  expandPathTemplate,
  readSiteSettings,
  type Query,
  type SitePageType,
  type SiteSettings,
} from '@cardstack/runtime-common';
import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';

import type { CardContext, CardDef } from './card-api';

// What a site serves, shown to its owner as they edit its settings: the
// problems the settings have, and for each page type, the addresses its
// cards get. Everything here is worked out in the editor from the settings
// being edited, with the same rules the server uses, and the owner's own
// searches. Nothing is asked of the server that a visitor couldn't ask.

// How many cards of a page type are looked at, and how many of them are
// shown as examples.
const SAMPLE_SIZE = 50;
const EXAMPLES = 5;

// The site settings as their search doc holds them, which is what the server
// reads, from the field instance being edited.
type SiteValue = Record<string, any> | undefined;

function siteData(site: SiteValue): unknown {
  if (!site) {
    return undefined;
  }
  let idOf = (card: { id?: string } | null | undefined) =>
    card?.id ? { id: card.id } : undefined;
  return {
    tagline: site.tagline,
    language: site.language,
    themeColor: site.themeColor,
    listed: site.listed,
    pageTypes: (site.pageTypes ?? []).map((t: Record<string, any>) => ({
      name: t.name,
      sourceRealm: t.sourceRealm,
      cardType: t.cardType
        ? { module: t.cardType.module, name: t.cardType.name }
        : undefined,
      filter: t.filter,
      path: t.path,
      sort: t.sort,
      aliases: t.aliases,
      listingPath: t.listingPath,
      listingTitle: t.listingTitle,
      listingSort: t.listingSort,
    })),
    redirects: (site.redirects ?? []).map((r: Record<string, any>) => ({
      from: r.from,
      to: r.to,
      statusCode: r.statusCode,
    })),
    crawlers: (site.crawlers ?? []).map((c: Record<string, any>) => ({
      userAgent: c.userAgent,
      allow: c.allow,
    })),
    notFound: idOf(site.notFound),
    errorCard: idOf(site.errorCard),
    frame: idOf(site.frame),
  };
}

// A card's value for a path variable: a field, or a linked card's field
// through a dot (`category.slug`).
function readVariable(card: CardDef, variable: string): unknown {
  if (variable === 'id') {
    return card.id;
  }
  let value: unknown = card;
  for (let key of variable.split('.')) {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: unknown }).id;
  }
  return value;
}

interface Signature {
  Args: {
    site: SiteValue;
    realmURL: string | undefined;
    context?: CardContext;
  };
}

// What one page type gives the cards the panel looked at.
interface Row {
  card: CardDef;
  path: string | undefined;
}

interface PageTypeReport {
  pageType: SitePageType;
  loading: boolean;
  total: number | undefined;
  looked: number;
  examples: Row[];
  withoutAddress: number;
  // Addresses more than one of its cards expand to. The site serves the
  // first, in the page type's sort.
  shared: { path: string; titles: string[] }[];
  // Addresses of its cards that an earlier page type already serves, so
  // these cards aren't served there.
  taken: {
    path: string;
    title: string;
    by: { title: string; pageType: string };
  }[];
}

type Search = ReturnType<NonNullable<CardContext['getCards']>>;

// The search the server runs to find a page type's cards, as the owner.
function queryFor(pageType: SitePageType | undefined): Query | undefined {
  if (!pageType?.template) {
    return undefined;
  }
  let on = pageType.cardType;
  let filter = pageType.filter
    ? { ...JSON.parse(pageType.filter), on }
    : { type: on };
  let sort = pageType.sort
    ? (JSON.parse(pageType.sort) as Record<string, unknown>[]).map((s) => ({
        on,
        ...s,
      }))
    : undefined;
  return {
    filter,
    page: { number: 0, size: SAMPLE_SIZE },
    ...(sort ? { sort } : {}),
  } as Query;
}

export default class SiteRoutesPanel extends GlimmerComponent<Signature> {
  get settings(): SiteSettings | undefined {
    if (!this.args.realmURL) {
      return undefined;
    }
    return readSiteSettings(siteData(this.args.site), this.args.realmURL);
  }

  get pageTypes(): SitePageType[] {
    return this.settings?.pageTypes ?? [];
  }

  get problems(): string[] {
    return this.settings?.problems ?? [];
  }

  // One search per page type, kept while the page type keeps its place and
  // name, so editing its path or filter re-runs it rather than starting over.
  private searches = new Map<string, Search | undefined>();

  private searchFor(index: number): Search | undefined {
    let key = `${index}:${this.pageTypes[index]?.name}`;
    if (!this.searches.has(key)) {
      this.searches.set(
        key,
        this.args.context?.getCards?.(
          this,
          () => queryFor(this.pageTypes[index]),
          () => {
            let realm = this.pageTypes[index]?.sourceRealm;
            return realm ? [realm] : undefined;
          },
        ),
      );
    }
    return this.searches.get(key);
  }

  // Each page type's cards and their addresses, in the order the site tries
  // them: an address an earlier page type serves is that one's.
  get reports(): PageTypeReport[] {
    let claimed = new Map<string, { title: string; pageType: string }>();
    return this.pageTypes.map((pageType, index) => {
      let search = this.searchFor(index);
      let template = pageType.template;
      let rows: Row[] = template
        ? (search?.instances ?? []).map((card) => ({
            card,
            path: expandPathTemplate(template!, (v) => readVariable(card, v)),
          }))
        : [];
      let byPath = new Map<string, string[]>();
      let taken: PageTypeReport['taken'] = [];
      for (let { card, path } of rows) {
        if (!path) {
          continue;
        }
        byPath.set(path, [...(byPath.get(path) ?? []), card.cardTitle]);
        let by = claimed.get(path);
        if (by && by.pageType !== pageType.name) {
          taken.push({ path, title: card.cardTitle, by });
        }
      }
      for (let { card, path } of rows) {
        if (path && !claimed.has(path)) {
          claimed.set(path, { title: card.cardTitle, pageType: pageType.name });
        }
      }
      return {
        pageType,
        loading: Boolean(search?.isLoading),
        total: search?.meta?.page?.total,
        looked: rows.length,
        examples: rows.slice(0, EXAMPLES),
        withoutAddress: rows.filter((r) => !r.path).length,
        shared: [...byPath]
          .filter(([, titles]) => titles.length > 1)
          .map(([path, titles]) => ({ path, titles })),
        taken,
      };
    });
  }

  <template>
    {{#if this.settings}}
      <section class='site-routes' data-test-site-routes>
        <h3 class='heading'>What the site serves</h3>
        {{#if this.problems.length}}
          <ul class='problems' data-test-site-routes-problems>
            {{#each this.problems as |problem|}}
              <li><AlertTriangleIcon
                  class='icon'
                  width='16'
                  height='16'
                />{{problem}}</li>
            {{/each}}
          </ul>
        {{/if}}
        {{#each this.reports as |report|}}
          <PageTypeRoutes @report={{report}} />
        {{else}}
          <p class='empty'>No page types yet. Add one to give cards addresses on
            the site.</p>
        {{/each}}
      </section>
    {{/if}}
    <style scoped>
      .site-routes {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        color: var(--muted-foreground);
      }
      .heading {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .problems {
        display: grid;
        gap: var(--boxel-sp-xxs);
        padding: 0;
        list-style: none;
        font-size: var(--boxel-font-size-sm);
        color: var(--destructive-ink);
      }
      .problems li {
        display: flex;
        gap: var(--boxel-sp-xxs);
        align-items: flex-start;
      }
      .icon {
        flex-shrink: 0;
      }
      .empty {
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

interface PageTypeSignature {
  Args: { report: PageTypeReport };
}

const PageTypeRoutes: TemplateOnlyComponent<PageTypeSignature> = <template>
  <div
    class='page-type'
    data-test-site-routes-page-type={{@report.pageType.name}}
  >
    <div class='title'>
      <strong>{{@report.pageType.name}}</strong>
      {{#if @report.pageType.template}}
        <code
          data-test-site-routes-template
        >{{@report.pageType.template.source}}</code>
      {{/if}}
      {{#if @report.total}}
        <span class='count'>{{@report.total}} cards</span>
      {{/if}}
    </div>
    {{#if @report.loading}}
      <LoadingIndicator />
    {{else if @report.examples.length}}
      <ul class='examples'>
        {{#each @report.examples as |row|}}
          <li data-test-site-routes-example>
            <span class='card-title'>{{row.card.cardTitle}}</span>
            {{#if row.path}}
              <code>{{row.path}}</code>
            {{else}}
              <span class='missing'>no address</span>
            {{/if}}
          </li>
        {{/each}}
      </ul>
      {{#if @report.withoutAddress}}
        <p class='note' data-test-site-routes-without-address>
          {{@report.withoutAddress}}
          of the first
          {{@report.looked}}
          cards have no address: a field the path names is empty.
        </p>
      {{/if}}
      {{#each @report.shared as |entry|}}
        <p class='note' data-test-site-routes-shared>
          <code>{{entry.path}}</code>
          is the address of
          {{entry.titles.length}}
          cards ({{#each entry.titles as |title i|}}{{if
              i
              ', '
            }}{{title}}{{/each}}). The site serves the first, in this page
          type's sort.
        </p>
      {{/each}}
      {{#each @report.taken as |entry|}}
        <p class='note' data-test-site-routes-taken>
          {{entry.title}}
          isn't served:
          <code>{{entry.path}}</code>
          is
          {{entry.by.title}}, from
          {{entry.by.pageType}}, which the site tries first.
        </p>
      {{/each}}
    {{else if @report.pageType.template}}
      <p class='note'>No cards match this page type yet.</p>
    {{else}}
      <p class='note' data-test-site-routes-invalid-path>
        The path isn't valid, so it isn't applied. Until it is, the site keeps
        serving these cards at their previous path, until its server next
        restarts; after that, they aren't served until the path is fixed.
      </p>
    {{/if}}
  </div>
  <style scoped>
    .page-type {
      display: grid;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .title {
      display: flex;
      flex-wrap: wrap;
      gap: var(--boxel-sp-xs);
      align-items: baseline;
      min-width: 0;
    }
    code {
      font-family: var(--font-mono);
      font-size: var(--boxel-font-size-sm);
      overflow-wrap: break-word;
      min-width: 0;
    }
    .count {
      font-size: var(--boxel-font-size-xs);
    }
    .examples {
      display: grid;
      gap: var(--boxel-sp-xxxs);
      padding: 0;
      list-style: none;
    }
    .examples li {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
    }
    .card-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .missing,
    .note {
      font-size: var(--boxel-font-size-sm);
      color: var(--destructive-ink);
    }
  </style>
</template>;
