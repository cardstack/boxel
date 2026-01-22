import { scheduleOnce } from '@ember/runloop';
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
    let pendingUpdate = false;

    let getMarkupSource = () => {
      // Remove the noise of the card container in the raw head preview
      return (
        element.querySelector<HTMLElement>(
          '[data-test-boxel-card-container]',
        ) ??
        element.firstElementChild ??
        element
      );
    };

    let updateHeadMarkup = () => {
      pendingUpdate = false;

      let markupSource = getMarkupSource();
      let nextMarkup = markupSource.innerHTML.trim();

      if (nextMarkup !== this.headMarkup) {
        this.headMarkup = nextMarkup;
      }
    };

    let scheduleUpdate = () => {
      if (pendingUpdate) {
        return;
      }

      pendingUpdate = true;

      // Prevent updating this.headMarkup twice in one render
      scheduleOnce('afterRender', this, updateHeadMarkup);
    };

    scheduleUpdate();

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    // Watch for updates to head format HTML, update tracked property
    let observer = new MutationObserver(scheduleUpdate);

    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    return () => observer.disconnect();
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
  private get prettyHeadMarkup() {
    if (!this.headMarkup) {
      return '';
    }

    let lines = this.headMarkup.split('\n');

    return lines
      .map((line) => line.trimStart())
      .join('\n')
      .trim();
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
    return `${text.substring(0, maxLength - 3)}…`;
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
        <h2 class='section-title'>Google</h2>
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
        <h2 class='section-title'>Facebook</h2>
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
        <h2 class='section-title'>Twitter / X</h2>
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
          <h2 class='section-title'>Raw head markup</h2>
          <div class='meta-code'>
            <pre data-test-head-markup>{{this.prettyHeadMarkup}}</pre>
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
        background-image: url('./operator-mode/code-submode/playground/playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-lg);
        border: var(--boxel-border);
        box-shadow: var(--boxel-box-shadow);
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
        font: 700 var(--boxel-font-sm);
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background: var(--boxel-200);
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius);
        border: 1px solid var(--boxel-200);
      }

      .google-preview {
        background: var(--boxel-light);
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        padding: var(--boxel-sp-lg);
        box-shadow: 0 2px 8px rgba(0 0 0 / 0.08);
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
        background: #f1f3f4;
        font: 700 var(--boxel-font-xs);
        color: #5f6368;
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
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: 400;
        color: #202124;
        line-height: 1.3;
      }

      .google-breadcrumb {
        font-family: Arial, sans-serif;
        font-size: 12px;
        color: #4d5156;
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
        border-radius: 12px;
        overflow: hidden;
        max-width: 550px;
        box-shadow: var(--boxel-box-shadow);
      }

      .facebook-image {
        width: 100%;
        aspect-ratio: 1.91 / 1;
        background: #e4e6eb;
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
        background: var(--boxel-700);
        border: 1px solid var(--boxel-600);
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
        color: var(--boxel-light);
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
