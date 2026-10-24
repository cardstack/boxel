import { MarkdownPreview } from '@cardstack/base/file-formats/index';
import type { MarkdownDef } from '@cardstack/base/markdown-file-def';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import type { GuideSection } from '../lib/guide-index';
import { realmFile } from '../lib/realm-url';
import { theaterView } from '../lib/theater';
import { SiteFrame } from './site-frame';

interface Signature {
  Args: {
    /** the slug of the guide on the page: `core-start`, or `README` for the index */
    current: string | undefined;
    /** the guide's Markdown file */
    document: MarkdownDef | undefined;
    /** the index's sections, in reading order */
    sections: GuideSection[];
  };
}

const href = (slug: string) => realmFile(`docs/guides/${slug}`);

const isCurrent = (slug: string, current: string | undefined) =>
  slug === current ? 'page' : undefined;

/**
 * A guide, read on the site: the gallery's frame, the guides' sections down
 * the side, and the guide's own Markdown. The Markdown is base's content-only
 * renderer, which resolves the guide's `::card[…]` embeds into live demos and
 * draws none of a file's own chrome; the gallery styles it through the
 * renderer's `--markdown-*` properties. The pager is the guide's last line.
 */
export class GuidePage extends Component<Signature> {
  /** on a narrow page the sections fold away above the guide */
  @tracked navOpen = false;

  home = realmFile('');
  indexHref = href('README');
  href = href;
  isCurrent = isCurrent;

  toggleNav = () => {
    this.navOpen = !this.navOpen;
  };

  /**
   * The sections scroll on their own beside the guide; they open scrolled to
   * the guide being read, which may sit far down the list.
   */
  showCurrent = modifier(
    (nav: HTMLElement, [current]: [string | undefined]) => {
      let link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (current && link && nav.scrollHeight > nav.clientHeight) {
        nav.scrollTop = link.offsetTop - nav.clientHeight / 3;
      }
    },
  );

  <template>
    <SiteFrame @home={{this.home}}>
      <div class='guide-page' {{theaterView}}>
        <div class='guide-layout'>
          <nav
            class='guide-nav {{if this.navOpen "is-open"}}'
            aria-label='Guides'
            {{this.showCurrent @current}}
            data-test-guide-nav
          >
            <a class='guide-back' href={{this.home}} data-test-guide-home>
              <span aria-hidden='true'>←</span>
              Gallery
            </a>
            <button
              type='button'
              class='guide-nav-toggle'
              aria-expanded={{if this.navOpen 'true' 'false'}}
              {{on 'click' this.toggleNav}}
            >Guides</button>
            <div class='guide-sections'>
              <a
                class='guide-all'
                href={{this.indexHref}}
                aria-current={{this.isCurrent 'README' @current}}
              >All guides</a>
              {{#each @sections as |part|}}
                <section class='guide-section' data-test-guide-section>
                  <p class='guide-section-title' data-test-guide-section-title>
                    {{#if part.number}}
                      <span class='guide-section-number'>{{part.number}}</span>
                    {{/if}}
                    {{part.title}}
                  </p>
                  <ol aria-label={{part.title}}>
                    {{#each part.guides as |guide|}}
                      <li>
                        <a
                          href={{this.href guide.slug}}
                          aria-current={{this.isCurrent guide.slug @current}}
                          data-test-guide-nav-link={{guide.slug}}
                        >{{guide.title}}</a>
                      </li>
                    {{/each}}
                  </ol>
                </section>
              {{/each}}
            </div>
          </nav>
          <article class='guide-article' data-test-guide-article>
            {{#if @document}}
              <MarkdownPreview
                @model={{@document}}
                @format='isolated'
                @displayContainer={{false}}
              />
            {{/if}}
          </article>
        </div>
      </div>
    </SiteFrame>
    <style scoped>
      /* the layout answers to the width the card is given, which in a stack
         is narrower than the window */
      .guide-page {
        container: guide-page / inline-size;
      }

      .guide-layout {
        display: grid;
        grid-template-columns: 236px minmax(0, 1fr);
        gap: 56px;
        align-items: start;
      }

      /* the sections stay in view beside a long guide, under the site's
         sticky bar, and scroll on their own when they are taller than what
         the viewer can see of the card: `--view-h`, from `theaterView`.
         The links bleed left past the column to hang the current guide's
         bar in the gutter, so the scroll box pads out by as much as they
         bleed (and gives the focus rings room), and a matching negative
         margin keeps the links where the column puts them. */
      .guide-nav {
        --_guide-nav-bleed: 12px;
        position: sticky;
        top: calc(96px - var(--_guide-nav-bleed));
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-height: calc(var(--view-h, 100dvh) - 120px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: var(--_guide-nav-bleed);
        margin: calc(-1 * var(--_guide-nav-bleed));
        font-size: 13px;
        line-height: 1.4;
      }

      .guide-back,
      .guide-all,
      .guide-nav-toggle {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .guide-back {
        color: var(--copper-ink);
        text-decoration: none;
      }

      .guide-nav-toggle {
        display: none;
      }

      .guide-sections {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .guide-all {
        color: var(--muted-foreground);
        text-decoration: none;
      }

      .guide-section-title {
        display: flex;
        gap: 8px;
        margin: 0 0 8px;
        font-family: var(--boxel-eyebrow-font-family);
        font-weight: var(--boxel-eyebrow-font-weight);
        font-size: calc(var(--boxel-eyebrow-font-size) * 10 / 11);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: calc(var(--boxel-eyebrow-letter-spacing) * 16 / 18);
        text-transform: uppercase;
        color: var(--primary-ink);
      }

      .guide-section-number {
        color: var(--subtle-foreground);
      }

      .guide-section ol {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .guide-section a {
        display: block;
        padding: 4px 10px;
        margin-left: -10px;
        border-left: 2px solid transparent;
        color: var(--muted-foreground);
        text-decoration: none;
      }

      .guide-nav a[aria-current='page'] {
        color: var(--foreground);
      }

      .guide-section a[aria-current='page'] {
        border-left-color: var(--primary-ink);
        background: color-mix(in srgb, var(--surface-tint) 5%, transparent);
      }

      @media (hover: hover) {
        .guide-nav a:hover {
          color: var(--foreground);
        }
      }

      /* The guide's Markdown in the gallery's type and palette, through the
         renderer's styling contract. Its text runs at a reading measure,
         while its live demos and code keep the column's width. Code blocks
         keep a dark surface in either theme: the renderer sets their text
         light. */
      .guide-article {
        min-width: 0;
        max-width: 820px;
        color: var(--foreground);
        --boxel-border: 1px solid var(--border);
        --markdown-font-family: var(--font-sans);
        --markdown-font-size: 16px;
        --markdown-line-height: 1.7;
        --markdown-prose-max-width: 68ch;
        --markdown-heading-font-family: var(--font-display);
        --markdown-heading-font-weight: 700;
        --markdown-heading-scroll-margin: 96px;
        --markdown-h1-font-size: clamp(32px, 5cqi, 46px);
        --markdown-h1-line-height: 1.08;
        --markdown-h1-margin-block: 0 24px;
        --markdown-h2-font-size: clamp(22px, 3.2cqi, 28px);
        --markdown-h2-line-height: 1.18;
        --markdown-h2-margin-block: 48px 12px;
        --markdown-h3-font-size: 19px;
        --markdown-h3-margin-block: 32px 8px;
        --markdown-link-color: var(--copper-ink);
        --markdown-border-color: var(--border);
        --markdown-muted-background: color-mix(
          in srgb,
          var(--surface-tint) 6%,
          transparent
        );
        --markdown-code-background: color-mix(
          in srgb,
          var(--surface-tint) 8%,
          transparent
        );
        --markdown-code-font-size: 0.86em;
        --markdown-code-padding: 0.1em 0.35em;
        --markdown-code-border-radius: 4px;
        --markdown-pre-background: #221e1a;
        --markdown-pre-border-radius: 18px;
        --markdown-pre-padding: 16px 18px;
        --markdown-pre-font-size: 12.5px;
        --markdown-pre-line-height: 1.55;
        --markdown-blockquote-border-left: 2px solid var(--copper);
        --markdown-blockquote-border-right: none;
        --markdown-blockquote-padding: 0 0 0 18px;
        --markdown-blockquote-p-font-size: 1em;
        --markdown-blockquote-font-style: normal;
      }

      /* narrow: the sections fold into a button above the guide */
      @container guide-page (max-width: 860px) {
        .guide-layout {
          grid-template-columns: minmax(0, 1fr);
          gap: 24px;
        }

        .guide-nav {
          position: static;
          max-height: none;
          overflow: visible;
          margin: 0;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          padding: 0 0 16px;
          border-bottom: 1px solid var(--border);
        }

        .guide-nav-toggle {
          display: inline-flex;
          padding: 6px 12px;
          border: 1px solid var(--border-strong);
          border-radius: 999px;
          background: none;
          color: var(--muted-foreground);
        }

        .guide-nav-toggle::after {
          margin-left: 8px;
          content: '▾';
        }

        .guide-nav.is-open .guide-nav-toggle::after {
          content: '▴';
        }

        .guide-sections {
          display: none;
          flex-basis: 100%;
        }

        .guide-nav.is-open .guide-sections {
          display: flex;
        }
      }
    </style>
  </template>
}
