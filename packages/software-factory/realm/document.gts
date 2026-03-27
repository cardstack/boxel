// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { modifier } from 'ember-modifier'; // ¹ Modifier for DOM manipulation
import {
  Component,
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api'; // ² Core imports
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown'; // ³ Markdown for content
import { gt } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import BookOpenIcon from '@cardstack/boxel-icons/book-open'; // ⁴ Document icon

// ⁵ Shared slugify function - deterministic ID generation
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

// ⁶ Parse headers from markdown text
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

// ⁷ Modifier to add IDs to rendered markdown headers
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

// ⁸ Main Document Card Definition
export class Document extends CardDef {
  static displayName = 'Document';
  static icon = BookOpenIcon;
  static prefersWideFormat = true; // ⁹ Enable wide format for documentation

  // ¹⁰ Computed title that respects cardInfo.name
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Document) {
      return this.cardInfo?.name ?? 'Untitled Document';
    },
  });

  // ¹² Main content in Markdown
  @field content = contains(MarkdownField);

  static embedded = class Embedded extends Component<typeof this> {
    // ¹³ Compact embedded format
    <template>
      <div class='document-embedded'>
        <div class='embedded-header'>
          <div class='doc-type-badge'>
            <svg
              class='badge-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              />
              <polyline points='14 2 14 8 20 8' />
            </svg>
            DOCUMENT
          </div>
          <h3 class='embedded-title'>{{if
              @model.cardTitle
              @model.cardTitle
              'Untitled Document'
            }}</h3>
        </div>

        {{#if @model.cardDescription}}
          <p class='embedded-description'>{{@model.cardDescription}}</p>
        {{/if}}
      </div>

      <style scoped>
        /* ¹⁴ Embedded card styling */
        .document-embedded {
          padding: 1.25rem;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }

        .embedded-header {
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
        }

        .doc-type-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin-bottom: 0.5rem;
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
          margin: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    // ¹⁵ Four sub-formats for grid display
    <template>
      <div class='fitted-container'>
        {{! Badge format */}}
        <div class='badge-format'>
          <div class='badge-title'>{{@model.cardTitle}}</div>
        </div>

        {{! Strip format */}}
        <div class='strip-format'>
          <div class='strip-left'>
            <svg
              class='strip-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              />
              <polyline points='14 2 14 8 20 8' />
            </svg>
            <div class='strip-title'>{{@model.cardTitle}}</div>
          </div>
        </div>

        {{! Tile format */}}
        <div class='tile-format'>
          <div class='tile-header'>
            <svg
              class='tile-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              />
              <polyline points='14 2 14 8 20 8' />
            </svg>
            <div class='tile-badge'>DOC</div>
          </div>
          <h4 class='tile-title'>{{@model.cardTitle}}</h4>
          {{#if @model.cardDescription}}
            <p class='tile-description'>{{@model.cardDescription}}</p>
          {{/if}}
        </div>

        {{! Card format */}}
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
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14 2 14 8 20 8' />
              </svg>
              <span class='card-type'>DOCUMENT</span>
            </div>
            <h4 class='card-title'>{{@model.cardTitle}}</h4>
          </div>
          {{#if @model.cardDescription}}
            <p class='card-description'>{{@model.cardDescription}}</p>
          {{/if}}
        </div>
      </div>

      <style scoped>
        /* ¹⁶ Fitted container with responsive sub-formats */
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
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    // ¹⁷ Isolated format matching SkillPlus layout

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
          '.doc-main',
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
        '.doc-main',
      ) as HTMLElement | null;
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    // ¹⁸ Extract headers from markdown for TOC
    get markdownHeaders() {
      if (!this.args.model?.content) return [];
      return parseMarkdownHeaders(this.args.model.content);
    }

    <template>
      <div class='document-container'>
        <div class='doc-layout'>
          {{! Sticky TOC sidebar */}}
          <aside class='toc-sidebar'>
            <div class='toc-header'>
              <h2 class='toc-title'>Contents</h2>
              <button class='top-button' {{on 'click' this.scrollToTop}}>
                ↑ TOP
              </button>
            </div>

            {{! template-lint-disable no-invalid-interactive*/}}
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
          </aside>

          {{! Main content area */}}
          <main class='doc-main'>
            {{! Header section */}}
            <header class='doc-header'>
              <div class='metadata-label'>DOCUMENT</div>
              <h1 class='doc-heading'>{{if
                  @model.cardTitle
                  @model.cardTitle
                  'Untitled Document'
                }}</h1>
              {{#if @model.cardDescription}}
                <p class='doc-subtitle'>{{@model.cardDescription}}</p>
              {{/if}}
            </header>

            {{! Content */}}
            {{#if @model.content}}
              <article class='content-article' {{addHeaderIds}}>
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
                  <path
                    d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                  />
                  <polyline points='14 2 14 8 20 8' />
                </svg>
                <h3 class='empty-heading'>Empty Document</h3>
                <p class='empty-description'>Start writing Markdown content to
                  populate this document.</p>
              </div>
            {{/if}}
          </main>
        </div>
      </div>

      <style scoped>
        /* ¹⁹ Professional documentation styling */

        .document-container {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
        }

        .doc-layout {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 1.5rem;
          height: 100%;
          max-width: 1600px;
          margin: 0 auto;
          padding: 1rem 1.5rem;
        }

        /* TOC Sidebar */
        .toc-sidebar {
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

        .toc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .toc-title {
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

        .top-button:active {
          transform: translateY(0);
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

        /* Main content area */
        .doc-main {
          overflow-y: auto;
          padding-right: 0.5rem;
          padding-bottom: 3rem;
        }

        /* Header section */
        .doc-header {
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

        .doc-heading {
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 0 0 0.5rem 0;
          color: var(--foreground);
          letter-spacing: -0.01em;
        }

        .doc-subtitle {
          font-size: 0.875rem;
          line-height: 1.5;
          color: var(--muted-foreground);
          margin: 0 0 1rem 0;
          max-width: 48rem;
        }

        /* Content article */
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

        /* TOC section titles */
        .toc-section {
          margin-bottom: 1.5rem;
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

        /* Responsive */
        @media (max-width: 1024px) {
          .doc-layout {
            grid-template-columns: 1fr;
            padding: 1rem;
            gap: 1rem;
          }

          .toc-sidebar {
            position: static;
            max-height: none;
            margin-bottom: 1rem;
          }

          .doc-main {
            padding-right: 0;
          }
        }

        @media (max-width: 640px) {
          .doc-layout {
            padding: 0.75rem;
          }

          .doc-heading {
            font-size: 1.25rem;
          }

          .doc-subtitle {
            font-size: 0.9375rem;
          }
        }
      </style>
    </template>
  };
}
// touched for re-index
