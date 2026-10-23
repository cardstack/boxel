import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import { MarkdownDef } from '@cardstack/base/markdown-file-def';
import StringField from '@cardstack/base/string';
import { provide } from 'ember-provide-consume-context';

import {
  CurrentGuideContext,
  type GuideSection,
  guideSections,
  guideSlug,
} from './lib/guide-index';
import { ChoreoRoot } from './shell/choreo-root';
import { GuidePage } from './shell/guide-page';

/**
 * A guide's page. Each guide's Markdown, `docs/guides/<slug>.md`, has its card
 * beside it, `docs/guides/<slug>.json`, so the guide's URL is the file's
 * without `.md` and the guide's relative links resolve the same from either.
 * The card holds no prose: it links its Markdown file and the guides' index,
 * and its title and description come from the file.
 */
class Isolated extends Component<typeof Guide> {
  /** the guide on the page, for the demos it embeds to know where they are */
  @provide(CurrentGuideContext)
  get currentGuide(): string | undefined {
    return guideSlug(this.args.model.id);
  }

  get sections(): GuideSection[] {
    return guideSections(this.args.model.index?.content ?? '');
  }

  <template>
    <GuidePage
      @document={{@model.document}}
      @current={{this.currentGuide}}
      @sections={{this.sections}}
    />
  </template>
}

/** a guide's title and what it covers, for wherever it is listed or linked */
class Summary extends Component<typeof Guide> {
  <template>
    <ChoreoRoot class='guide-summary'>
      <p class='guide-summary-kicker'>Choreo guide</p>
      <h3 class='guide-summary-title'>{{@model.cardTitle}}</h3>
      {{#if @model.cardDescription}}
        <p class='guide-summary-lede'>{{@model.cardDescription}}</p>
      {{/if}}
    </ChoreoRoot>
    <style scoped>
      .guide-summary {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        padding: 16px 18px;
        overflow: hidden;
      }

      .guide-summary-kicker {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--eyebrow);
      }

      .guide-summary-title {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 1.15rem;
        line-height: 1.2;
      }

      .guide-summary-lede {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 13px;
        line-height: 1.5;
        color: var(--ink-dim);
      }

      /* the smaller fitted sizes keep the title, and drop the lede and
         then the kicker as they run out of height */
      @container fitted-card (height < 115px) {
        .guide-summary-lede {
          display: none;
        }
      }

      @container fitted-card (height < 65px) {
        .guide-summary {
          justify-content: center;
          padding: 6px 12px;
        }

        .guide-summary-kicker {
          display: none;
        }

        .guide-summary-title {
          overflow: hidden;
          font-size: 0.95rem;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    </style>
  </template>
}

export class Guide extends CardDef {
  static displayName = 'Choreo Guide';
  static prefersWideFormat = true;

  /** the guide's Markdown, the one source of its prose */
  @field document = linksTo(MarkdownDef);
  /** the guides' index, `docs/guides/README.md`, whose sections the page lists */
  @field index = linksTo(MarkdownDef);

  /** the guide's first heading */
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Guide) {
      return this.document?.title;
    },
  });
  /** the guide's opening paragraph */
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Guide) {
      return this.document?.excerpt;
    },
  });

  static isolated = Isolated;
  static embedded = Summary;
  static fitted = Summary;
}
