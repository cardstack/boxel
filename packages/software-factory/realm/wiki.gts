import { modifier } from 'ember-modifier';
import {
  Component,
  CardDef,
  field,
  contains,
  containsMany,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { gt } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import BookOpenIcon from '@cardstack/boxel-icons/book-open';

// Slugify a wiki name to a URL-safe path segment
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Slugify heading text for TOC anchor IDs
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/^[\d.]+\s+/, '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Parse markdown headers for TOC
function parseMarkdownHeaders(
  markdown: string,
): Array<{ level: number; text: string; id: string }> {
  const headers: Array<{ level: number; text: string; id: string }> = [];
  const usedIds = new Set<string>();
  const headerRegex = /^(#{2,3})\s+(.+)$/gm;
  let match;

  while ((match = headerRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    let text = match[2].trim();
    const idMatch = text.match(/\{#([a-z0-9-]+)\}/);
    const explicitId = idMatch ? idMatch[1] : null;
    text = text.replace(/\s*\{#[a-z0-9-]+\}\s*/, '').trim();
    let baseId = explicitId || slugifyHeading(text);
    let finalId = baseId;
    let suffix = 2;
    while (usedIds.has(finalId)) {
      finalId = `${baseId}-${suffix}`;
      suffix++;
    }
    usedIds.add(finalId);
    headers.push({ level, text, id: finalId });
  }

  return headers;
}

// Extract [[Wiki Links]] from markdown content
function extractWikiLinks(markdown: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      links.push(name);
    }
  }
  return links;
}

// Modifier: adds IDs to rendered headings
const addHeaderIds = modifier((element: HTMLElement) => {
  const headers = element.querySelectorAll('h2, h3, h4, h5, h6');
  const usedIds = new Set<string>();

  headers.forEach((header) => {
    if (header.getAttribute('id')) return;
    const text = header.textContent || '';
    const idMatch = text.match(/\{#([a-z0-9-]+)\}/);
    let baseId: string;

    if (idMatch) {
      baseId = idMatch[1];
      header.textContent = text.replace(/\s*\{#[a-z0-9-]+\}\s*/, '').trim();
    } else {
      baseId = slugifyHeading(text);
    }

    let finalId = baseId;
    let suffix = 2;
    while (usedIds.has(finalId)) {
      finalId = `${baseId}-${suffix}`;
      suffix++;
    }

    if (finalId) {
      header.setAttribute('id', finalId);
      usedIds.add(finalId);
    }
  });
});

// Modifier: transforms [[Wiki Link]] text nodes into clickable <a> elements
// No args needed — click handling is done separately via an {{on}} handler
const processWikiLinks = modifier((element: HTMLElement) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue && node.nodeValue.includes('[[')) {
      textNodes.push(node);
    }
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue || '';
    const parts: (string | HTMLElement)[] = [];
    let lastIndex = 0;
    const regex = /\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const wikiName = match[1].trim();
      const wikiSlug = slugify(wikiName);
      const link = document.createElement('a');
      link.className = 'wiki-link';
      link.textContent = wikiName;
      link.setAttribute('data-wiki-name', wikiName);
      link.setAttribute('data-wiki-slug', wikiSlug);
      link.setAttribute('href', `#wiki:${wikiSlug}`);
      parts.push(link);

      lastIndex = match.index + match[0].length;
    }

    if (parts.length > 0) {
      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }

      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (typeof part === 'string') {
          fragment.appendChild(document.createTextNode(part));
        } else {
          fragment.appendChild(part);
        }
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }
});

export class Wiki extends CardDef {
  static displayName = 'Wiki';
  static icon = BookOpenIcon;
  static prefersWideFormat = true;

  @field content = contains(MarkdownField);
  @field tags = containsMany(StringField);
  @field relatedPages = linksToMany(() => Wiki);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Wiki) {
      return this.cardInfo?.name ?? this.cardInfo?.title ?? 'Untitled Page';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='wiki-embedded'>
        <div class='embedded-header'>
          <div class='wiki-type-badge'>
            <svg
              class='badge-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <path d='M2 12h20' />
              <path
                d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
              />
            </svg>
            WIKI
          </div>
          <h3 class='embedded-title'>{{if
              @model.cardTitle
              @model.cardTitle
              'Untitled Page'
            }}</h3>
        </div>
        {{#if @model.cardDescription}}
          <p class='embedded-description'>{{@model.cardDescription}}</p>
        {{/if}}
        {{#if @model.tags}}
          <div class='embedded-tags'>
            {{#each @model.tags as |tag|}}
              <span class='tag'>{{tag}}</span>
            {{/each}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .wiki-embedded {
          padding: 1.25rem;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }

        .embedded-header {
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        .wiki-type-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin-bottom: 0.375rem;
        }

        .badge-icon {
          width: 0.875rem;
          height: 0.875rem;
        }

        .embedded-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.3;
        }

        .embedded-description {
          font-size: 0.875rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          margin: 0 0 0.5rem 0;
        }

        .embedded-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
        }

        .tag {
          font-size: 0.6875rem;
          padding: 0.125rem 0.5rem;
          background: color-mix(in lab, var(--primary) 12%, var(--muted));
          color: var(--primary);
          border-radius: 9999px;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        {{! Badge format }}
        <div class='badge-format'>
          <svg
            class='badge-globe'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <circle cx='12' cy='12' r='10' />
            <path d='M2 12h20' />
            <path
              d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
            />
          </svg>
          <div class='badge-title'>{{@model.cardTitle}}</div>
        </div>

        {{! Strip format }}
        <div class='strip-format'>
          <div class='strip-left'>
            <svg
              class='strip-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <path d='M2 12h20' />
              <path
                d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
              />
            </svg>
            <div class='strip-title'>{{@model.cardTitle}}</div>
          </div>
          {{#if @model.tags}}
            <div class='strip-tags'>
              {{#each @model.tags as |tag|}}
                <span class='strip-tag'>{{tag}}</span>
              {{/each}}
            </div>
          {{/if}}
        </div>

        {{! Tile format }}
        <div class='tile-format'>
          <div class='tile-header'>
            <svg
              class='tile-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <path d='M2 12h20' />
              <path
                d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
              />
            </svg>
            <div class='tile-badge'>WIKI</div>
          </div>
          <h4 class='tile-title'>{{@model.cardTitle}}</h4>
          {{#if @model.cardDescription}}
            <p class='tile-description'>{{@model.cardDescription}}</p>
          {{/if}}
        </div>

        {{! Card format }}
        <div class='card-format'>
          <div class='card-header'>
            <div class='card-meta'>
              <svg
                class='card-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='M2 12h20' />
                <path
                  d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
                />
              </svg>
              <span class='card-type'>WIKI</span>
            </div>
            <h4 class='card-title'>{{@model.cardTitle}}</h4>
          </div>
          {{#if @model.cardDescription}}
            <p class='card-description'>{{@model.cardDescription}}</p>
          {{/if}}
          {{#if @model.tags}}
            <div class='card-tags'>
              {{#each @model.tags as |tag|}}
                <span class='card-tag'>{{tag}}</span>
              {{/each}}
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          background: var(--card);
          overflow: hidden;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }

        /* Badge */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
            padding: 0.375rem;
          }
        }

        .badge-globe {
          width: 1.25rem;
          height: 1.25rem;
          color: var(--primary);
        }

        .badge-title {
          font-size: clamp(0.625rem, 4%, 0.75rem);
          font-weight: 700;
          color: var(--foreground);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          line-height: 1.2;
        }

        /* Strip */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem 0.75rem;
            gap: 0.5rem;
          }
        }

        .strip-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
          flex: 1;
        }

        .strip-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: var(--primary);
          flex-shrink: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-tags {
          display: flex;
          gap: 0.25rem;
          flex-shrink: 0;
        }

        .strip-tag {
          font-size: 0.5625rem;
          padding: 0.125rem 0.375rem;
          background: color-mix(in lab, var(--primary) 12%, var(--muted));
          color: var(--primary);
          border-radius: 9999px;
          font-weight: 600;
          white-space: nowrap;
        }

        /* Tile */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.5rem, 3%, 0.875rem);
            gap: 0.5rem;
          }
        }

        .tile-header {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .tile-icon {
          width: 1rem;
          height: 1rem;
          color: var(--primary);
        }

        .tile-badge {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
        }

        .tile-title {
          font-size: clamp(0.875rem, 4%, 1rem);
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .tile-description {
          font-size: 0.6875rem;
          color: var(--muted-foreground);
          line-height: 1.4;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        /* Card */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.75rem, 3%, 1rem);
            gap: 0.75rem;
          }
        }

        .card-header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .card-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .card-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: var(--primary);
        }

        .card-type {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
        }

        .card-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .card-description {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .card-tag {
          font-size: 0.625rem;
          padding: 0.125rem 0.5rem;
          background: color-mix(in lab, var(--primary) 12%, var(--muted));
          color: var(--primary);
          border-radius: 9999px;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    // Handle clicks on wiki links inside rendered markdown content
    // Resolves [[Name]] links by matching against relatedPages, falls back to URL
    handleContentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const wikiLink = target?.closest?.('.wiki-link') as HTMLElement | null;
      if (!wikiLink) return;

      event.preventDefault();
      event.stopPropagation();

      const wikiName = wikiLink.getAttribute('data-wiki-name') || '';
      const wikiSlug = wikiLink.getAttribute('data-wiki-slug') || '';

      // Try to find the card in relatedPages by title match
      const pages = this.args.model?.relatedPages;
      if (pages) {
        const match = pages.find((p: Wiki) => {
          const title = (p.cardTitle || '').toLowerCase();
          return title === wikiName.toLowerCase();
        });
        if (match) {
          this.args.viewCard(match, 'isolated');
          return;
        }
      }

      // Fallback: construct URL from slug convention
      try {
        const cardId = this.args.model?.id;
        if (cardId) {
          const cardUrl = new URL(cardId);
          const pathParts = cardUrl.pathname.split('/');
          const wikiIndex = pathParts.indexOf('Wiki');
          const basePath =
            wikiIndex > 0
              ? pathParts.slice(0, wikiIndex).join('/')
              : pathParts.slice(0, -2).join('/');
          const targetUrl = new URL(
            `${cardUrl.origin}${basePath}/Wiki/${wikiSlug}`,
          );
          this.args.viewCard(targetUrl, 'isolated');
        }
      } catch (e) {
        // ignore navigation errors
      }
    };

    handleTocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      event.preventDefault();
      const id = decodeURIComponent(href.slice(1));

      const esc = (window as any).CSS?.escape
        ? (window as any).CSS.escape(id)
        : id;
      let targetElement = document.getElementById(id) as HTMLElement | null;
      if (!targetElement) {
        targetElement = document.querySelector(
          `[id="${esc}"]`,
        ) as HTMLElement | null;
      }

      if (targetElement) {
        const scrollContainer = document.querySelector(
          '.wiki-main',
        ) as HTMLElement | null;
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          const offset =
            targetRect.top - containerRect.top + scrollContainer.scrollTop - 32;
          scrollContainer.scrollTo({
            top: Math.max(0, offset),
            behavior: 'smooth',
          });
        } else {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    scrollToTop = () => {
      const scrollContainer = document.querySelector(
        '.wiki-main',
      ) as HTMLElement | null;
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    viewRelatedPage = (page: Wiki) => {
      this.args.viewCard(page, 'isolated');
    };

    get markdownHeaders() {
      if (!this.args.model?.content) return [];
      return parseMarkdownHeaders(this.args.model.content);
    }

    get outgoingWikiLinks() {
      if (!this.args.model?.content) return [];
      return extractWikiLinks(this.args.model.content);
    }

    <template>
      <div class='wiki-container'>
        <div class='wiki-layout'>
          {{! Sidebar }}
          <aside class='wiki-sidebar'>
            <div class='sidebar-header'>
              <h2 class='sidebar-title'>Contents</h2>
              <button
                class='top-button'
                type='button'
                {{on 'click' this.scrollToTop}}
              >
                ↑ TOP
              </button>
            </div>

            {{! TOC }}
            {{! template-lint-disable no-invalid-interactive }}
            <nav class='toc-navigation' {{on 'click' this.handleTocClick}}>
              {{#if @model.content}}
                <div class='toc-section'>
                  <div class='toc-section-title'>SECTIONS</div>
                  <ul>
                    {{#each this.markdownHeaders as |header|}}
                      <li
                        class={{if
                          (gt header.level 2)
                          'toc-subsection'
                          'toc-section-item'
                        }}
                      >
                        <a href='#{{header.id}}'>{{header.text}}</a>
                      </li>
                    {{/each}}
                  </ul>
                </div>
              {{/if}}
            </nav>

            {{! Wiki Links }}
            {{#if this.outgoingWikiLinks}}
              <div class='toc-section'>
                <div class='toc-section-title'>LINKED PAGES</div>
                <ul class='wiki-links-list'>
                  {{#each this.outgoingWikiLinks as |linkName|}}
                    <li class='wiki-link-item'>
                      <span class='link-arrow'>→</span>
                      {{linkName}}
                    </li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}

            {{! Related Pages }}
            {{#if @model.relatedPages}}
              <div class='toc-section'>
                <div class='toc-section-title'>RELATED PAGES</div>
                <ul class='related-list'>
                  {{#each @model.relatedPages as |page|}}
                    <li class='related-item'>
                      <button
                        class='related-button'
                        type='button'
                        {{on 'click' (fn this.viewRelatedPage page)}}
                      >
                        {{page.cardTitle}}
                      </button>
                    </li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}
          </aside>

          {{! Main content }}
          <main class='wiki-main'>
            <header class='wiki-header'>
              <div class='metadata-label'>WIKI</div>
              <h1 class='wiki-heading'>{{if
                  @model.cardTitle
                  @model.cardTitle
                  'Untitled Page'
                }}</h1>
              {{#if @model.cardDescription}}
                <p class='wiki-subtitle'>{{@model.cardDescription}}</p>
              {{/if}}
              {{#if @model.tags}}
                <div class='header-tags'>
                  {{#each @model.tags as |tag|}}
                    <span class='header-tag'>{{tag}}</span>
                  {{/each}}
                </div>
              {{/if}}
            </header>

            {{#if @model.content}}
              {{! template-lint-disable no-invalid-interactive }}
              <article
                class='content-article'
                {{addHeaderIds}}
                {{processWikiLinks}}
                {{on 'click' this.handleContentClick}}
              >
                <@fields.content />
              </article>
            {{else}}
              <div class='empty-state'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <path d='M2 12h20' />
                  <path
                    d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'
                  />
                </svg>
                <h3 class='empty-heading'>Empty Wiki Page</h3>
                <p class='empty-description'>Start writing content using
                  Markdown. Use
                  <code>[[Page Name]]</code>
                  to link to other wiki pages.</p>
              </div>
            {{/if}}
          </main>
        </div>
      </div>

      <style scoped>
        .wiki-container {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
        }

        .wiki-layout {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 1.5rem;
          height: 100%;
          max-width: 1600px;
          margin: 0 auto;
          padding: 1rem 1.5rem;
        }

        /* Sidebar */
        .wiki-sidebar {
          height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 0.75rem;
          padding-bottom: 2rem;
          display: flex;
          flex-direction: column;
        }

        .sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .sidebar-title {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin: 0;
        }

        .top-button {
          background: var(--primary);
          color: var(--primary-foreground);
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.25rem 0.5rem;
          font-size: 0.625rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .top-button:hover {
          background: color-mix(in lab, var(--primary) 85%, black);
          transform: translateY(-1px);
        }

        .toc-navigation {
          font-size: 0.75rem;
        }

        .toc-navigation :deep(ul) {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .toc-navigation :deep(li) {
          margin-bottom: 0.5rem;
        }

        .toc-navigation :deep(li.toc-section-item) {
          padding-left: 0.75rem;
        }

        .toc-navigation :deep(li.toc-subsection) {
          padding-left: 1.5rem;
          font-size: 0.6875rem;
        }

        .toc-navigation :deep(a) {
          color: var(--foreground);
          text-decoration: none;
          line-height: 1.5;
          transition: color 0.15s ease;
          display: inline-block;
        }

        .toc-navigation :deep(a:hover) {
          color: var(--primary);
        }

        .toc-section {
          margin-bottom: 1.25rem;
        }

        .toc-section-title {
          font-size: 0.625rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground);
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        .wiki-links-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .wiki-link-item {
          font-size: 0.75rem;
          color: #1d4ed8;
          margin-bottom: 0.375rem;
          padding-left: 0.75rem;
          display: flex;
          align-items: baseline;
          gap: 0.375rem;
        }

        .link-arrow {
          color: var(--foreground);
          font-size: 0.625rem;
          flex-shrink: 0;
          opacity: 0.5;
        }

        .related-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .related-item {
          margin-bottom: 0.25rem;
        }

        .related-button {
          background: none;
          border: none;
          color: #1d4ed8;
          font-size: 0.75rem;
          cursor: pointer;
          padding: 0.25rem 0.75rem;
          text-align: left;
          width: 100%;
          border-radius: var(--radius-sm);
          transition: background 0.15s ease;
        }

        .related-button:hover {
          background: color-mix(in lab, var(--primary) 8%, transparent);
        }

        /* Main content */
        .wiki-main {
          overflow-y: auto;
          padding-right: 0.5rem;
          padding-bottom: 3rem;
        }

        .wiki-header {
          margin-bottom: 2rem;
          padding: 0 0 1.25rem 0;
          border-bottom: 2px solid var(--border);
        }

        .metadata-label {
          font-size: 0.625rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--primary);
          margin-bottom: 0.5rem;
        }

        .wiki-heading {
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 0 0 0.5rem 0;
          color: var(--foreground);
          letter-spacing: -0.01em;
        }

        .wiki-subtitle {
          font-size: 0.875rem;
          line-height: 1.5;
          color: var(--muted-foreground);
          margin: 0 0 0.75rem 0;
          max-width: 48rem;
        }

        .header-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
        }

        .header-tag {
          font-size: 0.6875rem;
          padding: 0.125rem 0.625rem;
          background: color-mix(in lab, var(--primary) 12%, var(--muted));
          color: var(--primary);
          border-radius: 9999px;
          font-weight: 600;
        }

        /* Article content */
        .content-article {
          font-size: 0.9375rem;
          line-height: 1.7;
          color: var(--foreground);
        }

        .content-article :deep(h2) {
          font-size: 1.375rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 2rem 0 0.75rem 0;
          color: var(--foreground);
          scroll-margin-top: 6rem;
          padding-top: 0.5rem;
        }

        .content-article :deep(h2:first-child) {
          margin-top: 0;
        }

        .content-article :deep(h3) {
          font-size: 1.125rem;
          font-weight: 600;
          line-height: 1.4;
          margin: 1.5rem 0 0.5rem 0;
          color: var(--foreground);
          scroll-margin-top: 6rem;
        }

        .content-article :deep(p) {
          margin: 0.75rem 0;
          line-height: 1.6;
        }

        .content-article :deep(ul),
        .content-article :deep(ol) {
          margin: 0.75rem 0;
          padding-left: 1.5rem;
        }

        .content-article :deep(li) {
          margin: 0.5rem 0;
          line-height: 1.5;
        }

        .content-article :deep(code) {
          font-family: var(--font-mono);
          font-size: 0.875em;
          background: color-mix(in lab, var(--primary) 12%, var(--muted));
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-sm);
          color: var(--foreground);
          font-weight: 500;
        }

        .content-article :deep(pre) {
          margin: 1rem 0;
          padding: 1rem;
          background: #1e293b;
          border: 1px solid #334155;
          border-left: 3px solid var(--primary);
          border-radius: var(--radius-md);
          overflow-x: auto;
          font-size: 0.8125rem;
          line-height: 1.6;
          color: #e2e8f0;
        }

        .content-article :deep(pre code) {
          background: transparent;
          padding: 0;
          color: #e2e8f0;
        }

        .content-article :deep(blockquote) {
          margin: 1rem 0;
          padding: 0.75rem 1rem;
          border-left: 3px solid var(--primary);
          background: color-mix(in lab, var(--primary) 5%, var(--muted));
          color: var(--muted-foreground);
          font-style: italic;
        }

        .content-article :deep(a) {
          color: var(--primary);
          text-decoration: none;
          transition: color 0.15s ease;
        }

        .content-article :deep(a:hover) {
          text-decoration: underline;
        }

        .content-article :deep(hr) {
          margin: 2rem 0;
          border: none;
          border-top: 1px solid var(--border);
        }

        /* Wiki link styling (injected by modifier) */
        .content-article :deep(.wiki-link) {
          color: #1d4ed8;
          font-weight: 600;
          text-decoration: none;
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-sm);
          background: rgba(29, 78, 216, 0.08);
          transition: all 0.15s ease;
          cursor: pointer;
        }

        .content-article :deep(.wiki-link:hover) {
          background: rgba(29, 78, 216, 0.16);
          text-decoration: underline;
        }

        /* Tables */
        .content-article :deep(table) {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
          font-size: 0.875rem;
        }

        .content-article :deep(th) {
          background: var(--muted);
          font-weight: 700;
          text-align: left;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border);
        }

        .content-article :deep(td) {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border);
        }

        /* Empty state */
        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          max-width: 42rem;
          margin: 0 auto;
          color: var(--muted-foreground);
        }

        .empty-icon {
          width: 4rem;
          height: 4rem;
          margin: 0 auto 1.5rem;
          color: var(--primary);
          opacity: 0.6;
        }

        .empty-heading {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground);
          margin: 0 0 0.75rem 0;
        }

        .empty-description {
          margin: 0;
          font-size: 1rem;
          color: var(--muted-foreground);
        }

        .empty-description :deep(code) {
          font-family: var(--font-mono);
          font-size: 0.875em;
          background: color-mix(in lab, var(--primary) 12%, var(--muted));
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-sm);
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .wiki-layout {
            grid-template-columns: 1fr;
            padding: 1rem;
            gap: 1rem;
          }

          .wiki-sidebar {
            position: static;
            max-height: none;
            margin-bottom: 1rem;
          }

          .wiki-main {
            padding-right: 0;
          }
        }

        @media (max-width: 640px) {
          .wiki-layout {
            padding: 0.75rem;
          }

          .wiki-heading {
            font-size: 1.25rem;
          }
        }
      </style>
    </template>
  };
}
