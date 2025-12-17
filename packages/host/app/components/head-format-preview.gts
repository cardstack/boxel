import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { or } from '@cardstack/boxel-ui/helpers';

import type { ComponentLike } from '@glint/template';

type HeadPreviewData = {
  title: string;
  description: string;
  url?: string;
  image?: string;
  favicon?: string;
  siteName: string;
  twitterCard: string;
  type: string;
};

interface Signature {
  Element: any;
  Args: {
    renderedCard: ComponentLike<{ Args: { displayContainer?: boolean } }>;
    cardURL?: string;
  };
}

export default class HeadFormatPreview extends Component<Signature> {
  @tracked private headMarkup = '';

  captureHeadMarkup = modifier((element: HTMLElement) => {
    let container =
      element.querySelector<HTMLElement>('[data-test-boxel-card-container]') ??
      element.firstElementChild;
    let markupSource = container ?? element;
    this.headMarkup = markupSource.innerHTML.trim();
  });

  private get urlBase() {
    let providedURL = this.args.cardURL;
    if (providedURL) {
      return providedURL;
    }
    return typeof window !== 'undefined' ? window.location.href : undefined;
  }

  private normalizeURL(value?: string | null) {
    if (!value) {
      return undefined;
    }
    try {
      if (value.startsWith('//')) {
        let protocol =
          typeof window !== 'undefined' ? window.location.protocol : 'https:';
        return `${protocol}${value}`;
      }
      let base = this.urlBase;
      return base ? new URL(value, base).href : value;
    } catch {
      return value;
    }
  }

  private parseHead(markup: string) {
    if (typeof DOMParser === 'undefined') {
      return undefined;
    }
    try {
      return new DOMParser().parseFromString(
        `<head>${markup}</head>`,
        'text/html',
      );
    } catch {
      return undefined;
    }
  }

  private metaContent(
    doc: Document,
    selectors: Array<{ attr: 'property' | 'name' | 'itemprop'; value: string }>,
  ) {
    for (let selector of selectors) {
      let meta = doc.querySelector(
        `meta[${selector.attr}="${selector.value}"]`,
      );
      let content = meta?.getAttribute('content')?.trim();
      if (content) {
        return content;
      }
    }
    return undefined;
  }

  private extractHostname(url?: string) {
    if (!url) {
      return undefined;
    }
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  @cached
  private get headPreviewData(): HeadPreviewData {
    let defaults: HeadPreviewData = {
      title: 'Untitled page',
      description: 'Add title and description meta tags to see them here.',
      url: this.urlBase,
      siteName: 'Preview',
      image: undefined,
      favicon: undefined,
      twitterCard: 'summary_large_image',
      type: 'website',
    };

    if (!this.headMarkup) {
      return defaults;
    }

    let doc = this.parseHead(this.headMarkup);
    if (!doc) {
      return defaults;
    }

    let url = this.normalizeURL(
      this.metaContent(doc, [
        { attr: 'property', value: 'og:url' },
        { attr: 'name', value: 'twitter:url' },
      ]) ??
        doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
        this.urlBase,
    );

    let image = this.normalizeURL(
      this.metaContent(doc, [
        { attr: 'property', value: 'og:image' },
        { attr: 'property', value: 'og:image:url' },
        { attr: 'name', value: 'twitter:image' },
      ]),
    );

    let title =
      doc.querySelector('title')?.textContent?.trim() ??
      this.metaContent(doc, [
        { attr: 'property', value: 'og:title' },
        { attr: 'name', value: 'twitter:title' },
      ]) ??
      defaults.title;

    let description =
      this.metaContent(doc, [
        { attr: 'name', value: 'description' },
        { attr: 'property', value: 'og:description' },
        { attr: 'name', value: 'twitter:description' },
      ]) ?? defaults.description;

    let siteName =
      this.metaContent(doc, [{ attr: 'property', value: 'og:site_name' }]) ??
      this.extractHostname(url) ??
      defaults.siteName;

    let favicon = this.normalizeURL(
      doc.querySelector('link[rel~="icon" i]')?.getAttribute('href')?.trim() ??
        doc.querySelector('link[rel="shortcut icon" i]')?.getAttribute('href'),
    );

    let twitterCard =
      this.metaContent(doc, [{ attr: 'name', value: 'twitter:card' }]) ??
      defaults.twitterCard;

    let type =
      this.metaContent(doc, [{ attr: 'property', value: 'og:type' }]) ??
      defaults.type;

    return {
      title,
      description,
      url,
      siteName,
      image,
      favicon,
      twitterCard,
      type,
    };
  }

  @cached
  private get previewUrlParts() {
    let raw = this.headPreviewData.url ?? this.urlBase;
    if (!raw) {
      return { host: 'example.com', path: '/preview' };
    }
    try {
      let parsed = new URL(raw);
      let path = parsed.pathname === '/' ? '' : parsed.pathname;
      return {
        host: parsed.hostname.replace(/^www\./, ''),
        path: `${path}${parsed.search}` || '/',
      };
    } catch {
      return { host: raw, path: '' };
    }
  }

  private get siteInitial() {
    return this.headPreviewData.siteName?.charAt(0).toUpperCase() ?? 'P';
  }

  <template>
    <div hidden aria-hidden='true' {{this.captureHeadMarkup}}>
      {{component @renderedCard displayContainer=false}}
    </div>

    <div class='head-preview'>
      <div class='head-preview__grid'>
        <section class='preview-card search-preview'>
          <div class='preview-card__header'>
            <span class='pill pill-google'>Google</span>
            <span class='muted'>Search result</span>
          </div>
          <div class='search-url'>
            <div class='favicon'>
              {{#if this.headPreviewData.favicon}}
                <img src={{this.headPreviewData.favicon}} alt='' />
              {{else}}
                <span>{{this.siteInitial}}</span>
              {{/if}}
            </div>
            <div class='url-text'>
              <div class='domain'>{{this.previewUrlParts.host}}</div>
              <div class='path'>{{this.previewUrlParts.path}}</div>
            </div>
          </div>
          <div class='search-title'>{{this.headPreviewData.title}}</div>
          <div
            class='search-description'
          >{{this.headPreviewData.description}}</div>
        </section>

        <div class='social-column'>
          <section class='preview-card social facebook-preview'>
            <div class='preview-card__header'>
              <span class='pill pill-facebook'>Facebook</span>
              <span class='muted'>{{this.headPreviewData.type}}</span>
            </div>
            <div class='social-card'>
              <div class='preview-image'>
                {{#if this.headPreviewData.image}}
                  <img
                    src={{this.headPreviewData.image}}
                    alt='Open Graph preview'
                  />
                {{else}}
                  <div class='image-placeholder'>Add og:image</div>
                {{/if}}
              </div>
              <div class='social-text'>
                <div class='domain'>{{this.previewUrlParts.host}}</div>
                <div class='social-title'>{{this.headPreviewData.title}}</div>
                <div class='social-description'>
                  {{this.headPreviewData.description}}
                </div>
              </div>
            </div>
          </section>

          <section class='preview-card social twitter-preview'>
            <div class='preview-card__header'>
              <span class='pill pill-twitter'>Twitter / X</span>
              <span class='muted'>{{this.headPreviewData.twitterCard}}</span>
            </div>
            <div class='social-card twitter-card'>
              <div class='preview-image compact'>
                {{#if this.headPreviewData.image}}
                  <img
                    src={{this.headPreviewData.image}}
                    alt='Twitter preview'
                  />
                {{else}}
                  <div class='image-placeholder'>Add twitter:image</div>
                {{/if}}
              </div>
              <div class='social-text'>
                <div class='domain'>{{this.previewUrlParts.host}}</div>
                <div class='social-title'>{{this.headPreviewData.title}}</div>
                <div class='social-description'>
                  {{this.headPreviewData.description}}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class='meta-highlights'>
        <div class='meta-chip'>
          <span class='label'>og:title</span>
          <span class='value'>{{this.headPreviewData.title}}</span>
        </div>
        <div class='meta-chip'>
          <span class='label'>og:description</span>
          <span class='value'>{{this.headPreviewData.description}}</span>
        </div>
        <div class='meta-chip'>
          <span class='label'>og:url</span>
          <span class='value'>
            {{or this.headPreviewData.url this.urlBase 'Not set'}}
          </span>
        </div>
        <div class='meta-chip'>
          <span class='label'>twitter:card</span>
          <span class='value'>{{this.headPreviewData.twitterCard}}</span>
        </div>
      </div>

      {{#if this.headMarkup}}
        <details class='raw-head'>
          <summary>View raw head markup</summary>
          <pre data-test-head-markup>{{this.headMarkup}}</pre>
        </details>
      {{/if}}
    </div>

    <style scoped>
      .head-preview {
        --head-preview-surface-strong: var(--boxel-purple-700);
        --head-preview-surface-soft: var(--boxel-purple-800);
        --head-preview-border: var(--boxel-border-flexible);
        --head-preview-card-border: var(--boxel-border-card);
        --head-preview-card-shadow: var(--boxel-deep-box-shadow);
        --head-preview-muted: var(--boxel-450);
        --head-preview-path: var(--boxel-500);
        --head-preview-description: var(--boxel-550);
        --head-preview-domain: var(--boxel-dark-green);
        --head-preview-title: var(--boxel-blue);
        --head-preview-favicon-bg: var(--boxel-light-400);
        --head-preview-image-bg-start: var(--boxel-light-200);
        --head-preview-image-bg-end: var(--boxel-light-400);
        --head-preview-image-border: var(--boxel-light-500);
        --head-preview-chip-bg: var(--boxel-purple-700);
        --head-preview-chip-border: var(--boxel-border-flexible);
        --head-preview-raw-bg: var(--boxel-purple-800);
        --head-preview-raw-border: var(--boxel-border-flexible);
        --head-preview-pill-bg: var(--boxel-light-200);
        --head-preview-pill-border: var(--boxel-light-500);
        --head-preview-pill-color: var(--boxel-600);

        padding: var(--boxel-sp-lg);
        background: linear-gradient(
          145deg,
          var(--head-preview-surface-strong),
          var(--head-preview-surface-soft)
        );
        border-radius: var(--boxel-border-radius);
        border: 1px solid var(--head-preview-border);
      }
      .head-preview__grid {
        display: grid;
        grid-template-columns: 1.35fr 1fr;
        gap: var(--boxel-sp-md);
        align-items: start;
      }
      .social-column {
        display: grid;
        gap: var(--boxel-sp-md);
      }
      .preview-card {
        background: var(--boxel-light);
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius);
        border: var(--head-preview-card-border);
        box-shadow: var(--head-preview-card-shadow);
        padding: var(--boxel-sp-md);
      }
      .preview-card__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-sm);
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
        text-transform: uppercase;
      }
      .muted {
        color: var(--head-preview-muted);
        font-weight: 500;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        padding: 2px 8px;
        border-radius: 999px;
        font: 700 var(--boxel-font-xs);
        letter-spacing: 0.2px;
        text-transform: uppercase;
      }
      .pill-google {
        background: var(--head-preview-pill-bg);
        color: var(--head-preview-pill-color);
        border: 1px solid var(--head-preview-pill-border);
      }
      .pill-facebook {
        background: var(--head-preview-pill-bg);
        color: var(--head-preview-pill-color);
        border: 1px solid var(--head-preview-pill-border);
      }
      .pill-twitter {
        background: var(--head-preview-pill-bg);
        color: var(--head-preview-pill-color);
        border: 1px solid var(--head-preview-pill-border);
      }
      .search-url {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-sm);
      }
      .favicon {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        background: var(--head-preview-favicon-bg);
        display: grid;
        place-items: center;
        font: 700 var(--boxel-font-xs);
        color: var(--boxel-dark);
        overflow: hidden;
      }
      .favicon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .url-text {
        display: grid;
        gap: 2px;
      }
      .domain {
        color: var(--head-preview-domain);
        font: 600 var(--boxel-font-xs);
        letter-spacing: 0.15px;
      }
      .path {
        color: var(--head-preview-path);
        font: 500 var(--boxel-font-xs);
      }
      .search-title {
        color: var(--head-preview-title);
        font: 700 var(--boxel-font-md);
        margin-bottom: var(--boxel-sp-xxs);
        line-height: 1.3;
      }
      .search-description {
        color: var(--head-preview-description);
        font: 500 var(--boxel-font-sm);
        line-height: 1.5;
      }
      .social-card {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp-sm);
      }
      .social-card.twitter-card {
        grid-template-columns: 140px 1fr;
        align-items: center;
      }
      .preview-image {
        border-radius: var(--boxel-border-radius-sm);
        background: linear-gradient(
          135deg,
          var(--head-preview-image-bg-start),
          var(--head-preview-image-bg-end)
        );
        border: 1px solid var(--head-preview-image-border);
        overflow: hidden;
        min-height: 180px;
        display: grid;
        place-items: center;
      }
      .preview-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .preview-image.compact {
        min-height: 120px;
      }
      .image-placeholder {
        width: 100%;
        text-align: center;
        color: var(--head-preview-path);
        font: 600 var(--boxel-font-sm);
        padding: var(--boxel-sp-sm);
      }
      .social-text {
        display: grid;
        gap: 4px;
      }
      .social-title {
        font: 700 var(--boxel-font-sm);
        color: var(--boxel-dark);
        line-height: 1.3;
      }
      .social-description {
        color: var(--head-preview-description);
        font: 500 var(--boxel-font-xs);
        line-height: 1.4;
      }
      .meta-highlights {
        margin-top: var(--boxel-sp-md);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .meta-chip {
        background: var(--head-preview-chip-bg);
        border: 1px solid var(--head-preview-chip-border);
        border-radius: var(--boxel-border-radius-sm);
        padding: 8px 10px;
        color: var(--boxel-dark);
        display: grid;
        gap: 4px;
        min-width: 220px;
      }
      .meta-chip .label {
        font: 600 var(--boxel-font-xs);
        letter-spacing: 0.18px;
        text-transform: uppercase;
        opacity: 0.8;
      }
      .meta-chip .value {
        font: 500 var(--boxel-font-sm);
        word-break: break-word;
      }
      .raw-head {
        margin-top: var(--boxel-sp-md);
        color: var(--boxel-dark);
      }
      .raw-head > summary {
        cursor: pointer;
        font: 600 var(--boxel-font-xs);
        letter-spacing: 0.2px;
      }
      .raw-head > pre {
        margin-top: var(--boxel-sp-xs);
        white-space: pre-wrap;
        background: var(--head-preview-raw-bg);
        border: 1px solid var(--head-preview-raw-border);
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-sm);
        color: var(--boxel-light);
      }
      @media (max-width: 1100px) {
        .head-preview__grid {
          grid-template-columns: 1fr;
        }
        .social-card.twitter-card {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}
