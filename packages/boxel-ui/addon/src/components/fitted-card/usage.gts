import BookOpen from '@cardstack/boxel-icons/book-open';
import Calendar from '@cardstack/boxel-icons/calendar';
import { fn, hash } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { FITTED_FORMATS } from '../../helpers.ts';
import CardContainer from '../card-container/index.gts';
import FittedCardContainer from '../fitted-card-container/index.gts';
import BoxelInput from '../input/index.gts';
import Pill from '../pill/index.gts';
import { FittedCard } from './index.gts';
import { FittedUsagePreview } from './usage-preview.gts';

type BoolField =
  | 'showImage'
  | 'showPlaceholder'
  | 'showEyebrow'
  | 'showSubtitle'
  | 'showMeta'
  | 'showFooter'
  | 'showBadgeLeft'
  | 'showBadgeRight'
  | 'showBadgeRow';

interface FittedCardDemoState {
  showBadgeLeft: boolean;
  showBadgeRight: boolean;
  showBadgeRow: boolean;
  showEyebrow: boolean;
  showFooter: boolean;
  showImage: boolean;
  showMeta: boolean;
  showPlaceholder: boolean;
  showSubtitle: boolean;
}

interface FittedCardDemoSignature {
  Blocks: {
    default: [FittedCardDemoState];
  };
}

class FittedCardDemo extends Component<FittedCardDemoSignature> {
  @tracked showImage = true;
  @tracked showPlaceholder = true;
  @tracked showEyebrow = true;
  @tracked showSubtitle = true;
  @tracked showMeta = true;
  @tracked showFooter = true;
  @tracked showBadgeLeft = false;
  @tracked showBadgeRight = false;
  @tracked showBadgeRow = false;

  specs = [
    ...FITTED_FORMATS.flatMap((format) => ({
      title: format.name,
      items: format.specs,
    })),
  ];

  setCheck = (field: BoolField, event: Event) => {
    this[field] = (event.target as HTMLInputElement).checked;
  };

  <template>
    {{! template-lint-disable no-inline-styles style-concatenation }}
    <div class='demo'>
      <div class='demo-controls'>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showImage}}
            @onChange={{fn this.setCheck 'showImage'}}
          />
          Image
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showPlaceholder}}
            @onChange={{fn this.setCheck 'showPlaceholder'}}
          />
          Placeholder
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showEyebrow}}
            @onChange={{fn this.setCheck 'showEyebrow'}}
          />
          Eyebrow
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showSubtitle}}
            @onChange={{fn this.setCheck 'showSubtitle'}}
          />
          Subtitle
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showMeta}}
            @onChange={{fn this.setCheck 'showMeta'}}
          />
          Meta
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showFooter}}
            @onChange={{fn this.setCheck 'showFooter'}}
          />
          Footer
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showBadgeLeft}}
            @onChange={{fn this.setCheck 'showBadgeLeft'}}
          />
          Badge Left
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showBadgeRight}}
            @onChange={{fn this.setCheck 'showBadgeRight'}}
          />
          Badge Right
        </label>
        <label class='demo-toggle'>
          <BoxelInput
            @type='checkbox'
            @value={{this.showBadgeRow}}
            @onChange={{fn this.setCheck 'showBadgeRow'}}
          />
          Badge Row
        </label>
      </div>
      <FittedUsagePreview @specs={{this.specs}} as |spec|>
        <FittedCardContainer @size={{spec.id}}>
          <CardContainer
            @displayBoundaries={{true}}
            style={{htmlSafe
              'container-name: fitted-card; container-type: size; width: 100%; height: 100%'
            }}
          >
            {{yield
              (hash
                showImage=this.showImage
                showPlaceholder=this.showPlaceholder
                showEyebrow=this.showEyebrow
                showSubtitle=this.showSubtitle
                showMeta=this.showMeta
                showFooter=this.showFooter
                showBadgeLeft=this.showBadgeLeft
                showBadgeRight=this.showBadgeRight
                showBadgeRow=this.showBadgeRow
              )
            }}
          </CardContainer>
        </FittedCardContainer>
      </FittedUsagePreview>
    </div>
    <style scoped>
      .demo {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .demo-controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--background, var(--boxel-light));
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm);
      }
      .demo-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        font: var(--boxel-font-xs);
        cursor: pointer;
      }
    </style>
  </template>
}

export default class FittedCardUsage extends Component {
  @tracked imageUrl: string =
    'https://boxel-images.boxel.ai/app-assets/blog-posts/space-movie-thumb.jpeg';
  @tracked imageAlt: string = 'A sci-fi movie still';

  <template>
    <FreestyleUsage @name='FittedCard'>
      <:description>
        Responsive fitted-format card layout. Adapts automatically across all 16
        fitted sizes — from small badges to expanded cards — via CSS container
        queries on a named container provided by the runtime. All content is
        supplied via named blocks; only
        <code>title</code>
        is required.
        <pre>
          .sample-container-class {
            /* customize css vars here */
            container-name: fitted-card;
            container-type: size;
            width: /* ... */;
            height: /* ... */;
          }
        </pre>
        <strong>CSS custom properties</strong>
        — set on a custom class name on the card root element to override
        defaults:
        <br /><br />
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan='3'><em>Layout</em></td>
            </tr>
            <tr>
              <td><code>--fc-content-padding</code></td>
              <td><code>--boxel-sp-xs</code></td>
              <td>Padding inside the text column</td>
            </tr>
            <tr>
              <td><code>--fc-content-gap</code></td>
              <td><code>--boxel-sp-3xs</code></td>
              <td>Gap between header, meta, and footer</td>
            </tr>
            <tr>
              <td><code>--fc-content-gap-no-image</code></td>
              <td><code>--boxel-sp-xs</code></td>
              <td>Gap override applied when there is no image column</td>
            </tr>
            <tr>
              <td><code>--fc-header-gap</code></td>
              <td><code>--boxel-sp-6xs</code></td>
              <td>Gap between eyebrow, title, and subtitle</td>
            </tr>
            <tr>
              <td colspan='3'><em>Image column</em></td>
            </tr>
            <tr>
              <td><code>--fc-image-width</code></td>
              <td><code>40cqh</code></td>
              <td>Width of the image column in horizontal layouts</td>
            </tr>
            <tr>
              <td><code>--fc-image-min-width</code></td>
              <td><code>3.75rem</code></td>
              <td>Minimum width of the image column</td>
            </tr>
            <tr>
              <td><code>--fc-image-max-width</code></td>
              <td><code>12.5rem</code></td>
              <td>Maximum width cap for the image column</td>
            </tr>
            <tr>
              <td><code>--fc-image-height</code></td>
              <td><code>auto</code></td>
              <td>
                Height of the image area in vertical/tile layouts; breakpoints
                override this with a
                <code>cqmin</code>
                value
              </td>
            </tr>
            <tr>
              <td><code>--fc-image-background</code></td>
              <td><code>linear-gradient(var(--muted), var(--accent))</code></td>
              <td>
                Background of the image column when no image fills it
                (placeholder or empty)
              </td>
            </tr>
            <tr>
              <td><code>--fc-image-fade-color</code></td>
              <td><code>var(--card)</code></td>
              <td>
                Base color for the expanded-card image-to-content fade gradient;
                set to match a custom card background
              </td>
            </tr>
            <tr>
              <td><code>--fc-image-object-fit</code></td>
              <td><code>cover</code></td>
              <td>
                <code>object-fit</code>
                for the cover image
              </td>
            </tr>
            <tr>
              <td colspan='3'><em>Absolute badges</em></td>
            </tr>
            <tr>
              <td><code>--fc-badge-offset</code></td>
              <td><code>--boxel-sp-2xs</code></td>
              <td>
                Inset from card edges for absolutely-positioned
                <code>badgeLeft</code>
                /
                <code>badgeRight</code>
                badges
              </td>
            </tr>
            <tr>
              <td colspan='3'><em>Badge row</em></td>
            </tr>
            <tr>
              <td><code>--fc-badge-row-justify</code></td>
              <td><code>space-between</code></td>
              <td>
                <code>justify-content</code>
                for the badge row
              </td>
            </tr>
            <tr>
              <td><code>--fc-badge-row-gap</code></td>
              <td><code>--boxel-sp-2xs</code></td>
              <td>Gap between badge row items</td>
            </tr>
            <tr>
              <td colspan='3'><em>Typography</em></td>
            </tr>
            <tr>
              <td><code>--fc-eyebrow-font-size</code></td>
              <td><code>0.625rem</code></td>
              <td rowspan='2'>Eyebrow text size and line height</td>
            </tr>
            <tr>
              <td><code>--fc-eyebrow-line-height</code></td>
              <td><code>1.1</code></td>
            </tr>
            <tr>
              <td><code>--fc-title-font-size</code></td>
              <td><code>--boxel-font-size-sm</code></td>
              <td rowspan='3'>Title text size, line height, and max lines before
                truncation</td>
            </tr>
            <tr>
              <td><code>--fc-title-line-height</code></td>
              <td><code>1.2</code></td>
            </tr>
            <tr>
              <td><code>--fc-title-line-clamp</code></td>
              <td><code>2</code></td>
            </tr>
            <tr>
              <td><code>--fc-subtitle-font-size</code></td>
              <td><code>--boxel-font-size-xs</code></td>
              <td rowspan='3'>Subtitle text size, line height, and max lines
                before truncation</td>
            </tr>
            <tr>
              <td><code>--fc-subtitle-line-height</code></td>
              <td><code>1.1</code></td>
            </tr>
            <tr>
              <td><code>--fc-subtitle-line-clamp</code></td>
              <td><code>2</code></td>
            </tr>
            <tr>
              <td><code>--fc-meta-font-size</code></td>
              <td><code>--boxel-caption-font-size</code></td>
              <td rowspan='2'>Meta row text size and line height</td>
            </tr>
            <tr>
              <td><code>--fc-meta-line-height</code></td>
              <td><code>1.1</code></td>
            </tr>
            <tr>
              <td><code>--fc-footer-font-size</code></td>
              <td><code>--boxel-caption-font-size</code></td>
              <td>Footer row text size</td>
            </tr>
            <tr>
              <td colspan='3'><em>Meta &amp; footer flex row</em></td>
            </tr>
            <tr>
              <td><code>--fc-meta-justify</code></td>
              <td><code>flex-start</code></td>
              <td>
                <code>justify-content</code>
                for the meta row
              </td>
            </tr>
            <tr>
              <td><code>--fc-meta-align-items</code></td>
              <td><code>center</code></td>
              <td>
                <code>align-items</code>
                for the meta row
              </td>
            </tr>
            <tr>
              <td><code>--fc-meta-gap</code></td>
              <td><code>--boxel-sp-2xs</code></td>
              <td>Gap between meta items</td>
            </tr>
            <tr>
              <td><code>--fc-meta-flex-wrap</code></td>
              <td><code>nowrap</code></td>
              <td>
                <code>flex-wrap</code>
                for the meta row
              </td>
            </tr>
            <tr>
              <td><code>--fc-footer-justify</code></td>
              <td><code>flex-start</code></td>
              <td>
                <code>justify-content</code>
                for the footer row
              </td>
            </tr>
            <tr>
              <td><code>--fc-footer-align-items</code></td>
              <td><code>center</code></td>
              <td>
                <code>align-items</code>
                for the footer row
              </td>
            </tr>
            <tr>
              <td><code>--fc-footer-gap</code></td>
              <td><code>--boxel-sp-2xs</code></td>
              <td>Gap between footer items</td>
            </tr>
            <tr>
              <td><code>--fc-footer-flex-wrap</code></td>
              <td><code>nowrap</code></td>
              <td>
                <code>flex-wrap</code>
                for the footer row
              </td>
            </tr>
            <tr>
              <td colspan='3'><em>Section visibility</em></td>
            </tr>
            <tr>
              <td><code>--fc-image-display</code></td>
              <td><code>flex</code></td>
              <td>
                <code>display</code>
                for the image column; set to
                <code>none</code>
                to hide,
                <code>flex</code>
                to force-show
              </td>
            </tr>
            <tr>
              <td><code>--fc-badge-left-display</code></td>
              <td><code>block</code></td>
              <td>
                <code>display</code>
                for the absolute left badge; set to
                <code>none</code>
                to hide,
                <code>block</code>
                to force-show
              </td>
            </tr>
            <tr>
              <td><code>--fc-badge-right-display</code></td>
              <td><code>block</code></td>
              <td>
                <code>display</code>
                for the absolute right badge; set to
                <code>none</code>
                to hide,
                <code>block</code>
                to force-show
              </td>
            </tr>
            <tr>
              <td><code>--fc-badge-row-display</code></td>
              <td><code>flex</code></td>
              <td>
                <code>display</code>
                for the badge row; set to
                <code>none</code>
                to hide,
                <code>flex</code>
                to force-show
              </td>
            </tr>
            <tr>
              <td><code>--fc-subtitle-display</code></td>
              <td><code>-webkit-box</code></td>
              <td>
                <code>display</code>
                for the subtitle; set to
                <code>none</code>
                to hide
              </td>
            </tr>
            <tr>
              <td><code>--fc-meta-display</code></td>
              <td><code>flex</code></td>
              <td>
                <code>display</code>
                for the meta row; set to
                <code>none</code>
                to hide,
                <code>flex</code>
                to force-show
              </td>
            </tr>
            <tr>
              <td><code>--fc-footer-display</code></td>
              <td><code>flex</code></td>
              <td>
                <code>display</code>
                for the footer row; set to
                <code>none</code>
                to hide,
                <code>flex</code>
                to force-show
              </td>
            </tr>
          </tbody>
        </table>
      </:description>
      <:example>
        <FittedCardDemo as |demo|>
          <FittedCard
            class='my-fitted-card-class'
            @imageUrl={{if demo.showImage this.imageUrl}}
            @imageAlt={{this.imageAlt}}
            @titleTag='h5'
          >
            <:placeholder>{{#if demo.showPlaceholder}}<BookOpen
                  width='24'
                  height='24'
                />{{/if}}</:placeholder>
            <:eyebrow>{{#if demo.showEyebrow}}Movie Review{{/if}}</:eyebrow>
            <:title>Singularity&rsquo;s Echo &ndash; A Mind-Bending Sci-Fi
              Masterpiece</:title>
            <:subtitle>{{#if demo.showSubtitle}}In an era hungry for
                originality, "Singularity's Echo" emerges as a luminous beacon
                in the cosmic darkness—an audacious journey that redefines what
                viewers can expect from the genre. Directed by the elusive
                auteur Oruni Kilrain, this film harnesses the raw power of
                interstellar wonder and transforms it into a multilayered
                narrative tapestry. Blending heart-stirring drama with
                disorienting visuals, "Singularity's Echo" reminds us that true
                cinematic frontiers remain ripe for exploration, stretching
                beyond the gravitational pull of safe storytelling.{{/if}}</:subtitle>
            <:meta>{{#if demo.showMeta}}<Calendar width='14' height='14' />
                Oct 17, 2024{{/if}}</:meta>
            <:footer>{{#if demo.showFooter}}<strong>Robert Fields</strong>{{/if}}</:footer>
            <:badgeLeft>
              {{#if demo.showBadgeLeft}}
                <Pill @variant='primary'>New</Pill>
              {{/if}}
            </:badgeLeft>
            <:badgeRight>
              {{#if demo.showBadgeRight}}
                <Pill @variant='muted'>4.8 ★</Pill>
              {{/if}}
            </:badgeRight>
            <:badgeRow>{{#if demo.showBadgeRow}}<Pill
                  @variant='accent'
                >Sci-Fi</Pill><Pill @variant='secondary'>4.8 ★</Pill>{{/if}}</:badgeRow>
          </FittedCard>
        </FittedCardDemo>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='imageUrl'
          @description='Cover image URL. When present the image column is shown; omit to show the placeholder block instead.'
          @value={{this.imageUrl}}
          @onInput={{fn (mut this.imageUrl)}}
        />
        <Args.String
          @name='imageAlt'
          @description='Alt text for the cover image.'
          @value={{this.imageAlt}}
          @onInput={{fn (mut this.imageAlt)}}
        />
        <Args.String
          @name='imageLoading'
          @description="Loading behaviour for the cover image: 'lazy' or 'eager'. Omit to use the browser default."
        />
        <Args.String
          @name='titleTag'
          @description="HTML heading element for the title: 'h1' (default), 'h2', 'h3', etc. Pass 'h2' or 'h3' when cards appear in a list to preserve heading hierarchy."
        />
        <Args.Yield
          @name='title'
          @description='Primary heading.'
          @required={{true}}
        />
        <Args.Yield
          @name='placeholder'
          @description='Icon or content shown in the image column when @imageUrl is absent. Omitting this block removes the image column entirely.'
        />
        <Args.Yield
          @name='image'
          @description='Custom image block, rendered directly inside the image column. Alternative to @imageUrl for when you need markup rather than a bare URL.'
        />
        <Args.Yield
          @name='background'
          @description='Absolutely-positioned layer behind all content. Use for decorative background graphics or patterns.'
        />
        <Args.Yield
          @name='eyebrow'
          @description='Tiny uppercase overline rendered above the title. Styled with muted-foreground color and letter-spacing.'
        />
        <Args.Yield
          @name='subtitle'
          @description='Secondary line rendered below the title. Hidden at small sizes; line-clamped at larger ones.'
        />
        <Args.Yield
          @name='meta'
          @description='Additional content between the header and footer. Use for stats, tags, or secondary metadata. Hidden at strip and badge sizes.'
        />
        <Args.Yield
          @name='footer'
          @description='Bottom row for date, location, price, stats, etc. Anchored to the bottom of the content column. Hidden at badge and strip sizes.'
        />
        <Args.Yield
          @name='badgeLeft'
          @description='Absolutely-positioned group at the top-left corner of the card (over the image when present). Use for status pills or labels.'
        />
        <Args.Yield
          @name='badgeRight'
          @description='Absolutely-positioned group at the top-right corner of the card.'
        />
        <Args.Yield
          @name='badgeRow'
          @description='Inline flex row of badges or pills rendered above the header, inside the text column. Use for tags or category chips. Controlled by --fc-badge-row-justify (default space-between) and --fc-badge-row-gap.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      table {
        font-size: 0.8rem;
      }
      table td:first-child code {
        white-space: nowrap;
      }
      em {
        font-weight: 600;
      }
      strong {
        font-weight: 500;
      }
    </style>
  </template>
}
