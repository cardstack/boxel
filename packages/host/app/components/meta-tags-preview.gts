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

export default class MetaTagsPreview extends Component<Signature> {
  @tracked private headMarkup = '';

  captureHeadMarkup = modifier((element: HTMLElement) => {
    this.headMarkup = element.innerHTML.trim();
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
          <div class='search-description'>{{this.headPreviewData.description}}</div>
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
                    alt='Open Graph image preview'
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
                    alt='Twitter image preview'
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
          <pre>{{this.headMarkup}}</pre>
        </details>
      {{/if}}
    </div>

    <style scoped>
      .head-preview {
        padding: var(--boxel-sp-lg);
        background: linear-gradient(
          145deg,
          rgba(255 255 255 / 6%),
          rgba(255 255 255 / 2%)
        );
        border-radius: var(--boxel-border-radius);
        border: 1px solid rgba(255 255 255 / 8%);
        color: var(--boxel-light);
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
        border: 1px solid rgba(0 0 0 / 8%);
        box-shadow: 0 12px 40px rgba(0 0 0 / 24%);
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
        color: rgba(0 0 0 / 55%);
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
        background: #e8f3e6;
        color: #1b7f3c;
        border: 1px solid #c6e2c1;
      }
      .pill-facebook {
        background: #e7edfb;
        color: #1d4ed8;
        border: 1px solid #c2d1f8;
      }
      .pill-twitter {
        background: #e7f4fb;
        color: #0f89c4;
        border: 1px solid #c1e3f8;
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
        background: rgba(0 0 0 / 6%);
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
        color: #0f6938;
        font: 600 var(--boxel-font-xs);
        letter-spacing: 0.15px;
      }
      .path {
        color: rgba(0 0 0 / 60%);
        font: 500 var(--boxel-font-xs);
      }
      .search-title {
        color: #1a0dab;
        font: 700 var(--boxel-font-md);
        margin-bottom: var(--boxel-sp-xxs);
        line-height: 1.3;
      }
      .search-description {
        color: rgba(0 0 0 / 74%);
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
          rgba(0 0 0 / 5%),
          rgba(0 0 0 / 10%)
        );
        border: 1px solid rgba(0 0 0 / 6%);
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
        color: rgba(0 0 0 / 65%);
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
        color: rgba(0 0 0 / 70%);
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
        background: rgba(255 255 255 / 10%);
        border: 1px solid rgba(255 255 255 / 12%);
        border-radius: var(--boxel-border-radius-sm);
        padding: 8px 10px;
        color: var(--boxel-light);
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
        color: var(--boxel-light);
      }
      .raw-head > summary {
        cursor: pointer;
        font: 600 var(--boxel-font-xs);
        letter-spacing: 0.2px;
      }
      .raw-head > pre {
        margin-top: var(--boxel-sp-xs);
        white-space: pre-wrap;
        background: rgba(0 0 0 / 45%);
        border: 1px solid rgba(255 255 255 / 12%);
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
