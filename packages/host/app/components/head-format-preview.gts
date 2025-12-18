import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

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

  private get previewTitle() {
    return this.headPreviewData.title;
  }

  private get previewDescription() {
    return this.headPreviewData.description;
  }

  private get previewImage() {
    return this.headPreviewData.image;
  }

  private get previewUrl() {
    return this.headPreviewData.url ?? this.urlBase ?? '';
  }

  private get displayDomain() {
    return this.previewUrlParts.host || 'example.com';
  }

  private get breadcrumbPath() {
    let path = this.previewUrlParts.path?.replace(/^\//, '') ?? '';
    if (!path) {
      return '';
    }
    let segments = path.split('/').filter(Boolean);
    if (segments.length === 0) {
      return '';
    }
    return ` › ${segments.slice(0, 2).join(' › ')}`;
  }

  private truncate(text: string, maxLength: number) {
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength - 3)}...`;
  }

  private get googleTitle() {
    return this.truncate(this.previewTitle, 60);
  }

  private get googleDescription() {
    return this.truncate(this.previewDescription, 160);
  }

  private get facebookTitle() {
    return this.truncate(this.previewTitle, 88);
  }

  private get facebookDescription() {
    return this.truncate(this.previewDescription, 300);
  }

  private get twitterTitle() {
    return this.truncate(this.previewTitle, 70);
  }

  private get twitterDescription() {
    return this.truncate(this.previewDescription, 200);
  }

  <template>
    <div hidden aria-hidden='true' {{this.captureHeadMarkup}}>
      <@renderedCard @displayContainer={{false}} />
    </div>

    <div class='social-preview-container'>
      <header class='preview-header'>
        <h1 class='preview-title'>Social Media Preview</h1>
        <p class='preview-subtitle'>
          See how your card appears across platforms
        </p>
      </header>

      <section class='platform-section'>
        <h2 class='section-title'>
          <svg class='section-icon google-icon' viewBox='0 0 24 24' fill='none'>
            <path
              d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
              fill='#4285F4'
            />
            <path
              d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
              fill='#34A853'
            />
            <path
              d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
              fill='#FBBC05'
            />
            <path
              d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
              fill='#EA4335'
            />
          </svg>
          Google Search
        </h2>
        <div class='google-preview'>
          <div class='google-result'>
            <div class='google-url-row'>
              <div class='google-favicon'>
                {{#if this.headPreviewData.favicon}}
                  <img
                    src={{this.headPreviewData.favicon}}
                    alt='Site favicon'
                  />
                {{else}}
                  <span>{{this.siteInitial}}</span>
                {{/if}}
              </div>
              <div class='google-url-info'>
                <div class='google-site-name'>{{this.displayDomain}}</div>
                <div class='google-breadcrumb'>
                  {{this.displayDomain}}{{this.breadcrumbPath}}
                </div>
              </div>
            </div>
            <h3 class='google-title'>{{this.googleTitle}}</h3>
            <p class='google-description'>{{this.googleDescription}}</p>
          </div>
        </div>
      </section>

      <section class='platform-section'>
        <h2 class='section-title'>
          <svg
            class='section-icon facebook-icon'
            viewBox='0 0 24 24'
            fill='#1877F2'
          >
            <path
              d='M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z'
            />
          </svg>
          Facebook
        </h2>
        <div class='facebook-preview'>
          <div class='facebook-card'>
            {{#if this.previewImage}}
              <div class='facebook-image'>
                <img src={{this.previewImage}} alt='Preview' />
              </div>
            {{/if}}
            <div class='facebook-content'>
              <div class='facebook-domain'>{{this.displayDomain}}</div>
              <div class='facebook-title'>{{this.facebookTitle}}</div>
              <div
                class='facebook-description'
              >{{this.facebookDescription}}</div>
            </div>
          </div>
        </div>
      </section>

      <section class='platform-section'>
        <h2 class='section-title'>
          <svg
            class='section-icon twitter-icon'
            viewBox='0 0 24 24'
            fill='#000'
          >
            <path
              d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
            />
          </svg>
          Twitter / X
        </h2>
        <div class='twitter-preview'>
          <div class='twitter-card {{if this.previewImage "has-image" ""}}'>
            {{#if this.previewImage}}
              <div class='twitter-image'>
                <img src={{this.previewImage}} alt='Preview' />
              </div>
            {{/if}}
            <div class='twitter-content'>
              <div class='twitter-title'>{{this.twitterTitle}}</div>
              <div class='twitter-description'>{{this.twitterDescription}}</div>
              <div class='twitter-domain'>
                <svg
                  class='link-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'
                  />
                  <path
                    d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
                  />
                </svg>
                {{this.displayDomain}}
              </div>
            </div>
          </div>
        </div>
      </section>

      {{#if this.headMarkup}}
        <section class='meta-section'>
          <h2 class='section-title'>
            <svg
              class='section-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
              <line x1='3' y1='9' x2='21' y2='9' />
              <line x1='9' y1='21' x2='9' y2='9' />
            </svg>
            Raw head markup
          </h2>
          <div class='meta-code'>
            <pre data-test-head-markup>{{this.headMarkup}}</pre>
          </div>
        </section>
      {{/if}}
    </div>

    <style scoped>
      .social-preview-container {
        width: 100%;
        padding: var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xl);
        background: var(--boxel-light-100);
        background-image: radial-gradient(
          circle,
          var(--boxel-200) 1px,
          transparent 1px
        );
        background-size: 20px 20px;
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius-lg);
        border: var(--boxel-border);
      }

      .preview-header {
        padding: var(--boxel-sp-lg);
        border-bottom: 2px solid var(--boxel-200);
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-box-shadow);
      }

      .preview-title {
        font: 700 var(--boxel-font-lg);
        margin: 0 0 var(--boxel-sp-xxs);
        color: var(--boxel-dark);
      }

      .preview-subtitle {
        font: 400 var(--boxel-font-sm);
        color: var(--boxel-500);
        margin: 0;
      }

      .platform-section,
      .meta-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }

      .section-title {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font: 700 var(--boxel-font-sm);
        margin: 0 0 var(--boxel-sp-sm);
        color: var(--boxel-dark);
      }

      .section-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .google-preview {
        background: var(--boxel-light);
        border: var(--boxel-border);
        border-radius: 12px;
        padding: var(--boxel-sp-lg);
        box-shadow: var(--boxel-box-shadow);
      }

      .google-result {
        max-width: 600px;
      }

      .google-url-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-3xs);
      }

      .google-favicon {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        background: var(--boxel-light-400);
        font: 700 var(--boxel-font-xs);
      }

      .google-favicon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .google-url-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .google-site-name {
        font: 600 var(--boxel-font-xs);
        color: var(--boxel-dark);
        line-height: 1.3;
      }

      .google-breadcrumb {
        font: 500 var(--boxel-font-xxs, var(--boxel-font-xs));
        color: var(--boxel-500);
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .google-title {
        font-family: Arial, sans-serif;
        font-size: 20px;
        font-weight: 400;
        color: #1a0dab;
        line-height: 1.3;
        margin: 0 0 var(--boxel-sp-4xs);
      }

      .google-description {
        font-family: Arial, sans-serif;
        font-size: 14px;
        color: #4d5156;
        line-height: 1.58;
        margin: 0;
      }

      .facebook-preview {
        background: transparent;
      }

      .facebook-card {
        background: var(--boxel-light);
        border: var(--boxel-border);
        border-radius: 12px;
        overflow: hidden;
        max-width: 550px;
        box-shadow: var(--boxel-box-shadow);
      }

      .facebook-image {
        width: 100%;
        aspect-ratio: 1.91 / 1;
        background: var(--boxel-light-400);
        overflow: hidden;
      }

      .facebook-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .facebook-content {
        padding: 12px 14px;
        background: #f0f2f5;
        border-top: 1px solid #dddfe2;
      }

      .facebook-domain {
        font-size: 12px;
        color: #65676b;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        margin-bottom: 4px;
      }

      .facebook-title {
        font-size: 16px;
        font-weight: 600;
        color: #1c1e21;
        line-height: 1.25;
        margin-bottom: 4px;
      }

      .facebook-description {
        font-size: 14px;
        color: #606770;
        line-height: 1.35;
      }

      .twitter-preview {
        background: transparent;
      }

      .twitter-card {
        background: #000;
        border: 1px solid #2f3336;
        border-radius: 16px;
        overflow: hidden;
        max-width: 550px;
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .twitter-image {
        width: 100%;
        aspect-ratio: 1.91 / 1;
        background: #2f3336;
        overflow: hidden;
      }

      .twitter-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .twitter-content {
        padding: 12px;
      }

      .twitter-title {
        font-size: 15px;
        font-weight: 400;
        color: #e7e9ea;
        line-height: 1.3;
        margin-bottom: 2px;
      }

      .twitter-description {
        font-size: 15px;
        color: #71767b;
        line-height: 1.3;
        margin-bottom: 6px;
      }

      .twitter-domain {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 15px;
        color: #71767b;
      }

      .link-icon {
        width: 16px;
        height: 16px;
        color: #71767b;
      }

      .meta-code {
        background: var(--boxel-light);
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-md);
        overflow-x: auto;
        box-shadow: var(--boxel-box-shadow);
      }

      .meta-code pre {
        margin: 0;
        font-family: var(
          --boxel-monospace-font-family,
          'IBM Plex Mono',
          monospace
        );
        font-size: var(--boxel-font-xs);
        line-height: 1.6;
        color: var(--boxel-dark);
        white-space: pre-wrap;
      }

      @media (max-width: 640px) {
        .social-preview-container {
          padding: var(--boxel-sp-lg);
          gap: var(--boxel-sp-xl);
        }

        .preview-title {
          font-size: var(--boxel-font-md);
        }

        .google-title {
          font-size: 18px;
        }
      }
    </style>
  </template>
}
