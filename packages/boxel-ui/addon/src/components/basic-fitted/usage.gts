import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Captions from '@cardstack/boxel-icons/captions';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import type { Icon } from '../../icons.ts';
import {
  FITTED_FORMATS,
  sanitizeHtmlSafe,
  cn,
  gt,
  gte,
} from '../../helpers.ts';
import CardContainer from '../card-container/index.gts';
import BasicFitted from './index.gts';

type Spec = { title?: string; width: number; height: number };

const OTHER_SIZES: Spec[] = [
  { width: 226, height: 226 },
  { width: 164, height: 224 },
  { width: 164, height: 180 },
  { width: 140, height: 148 },
  { width: 120, height: 128 },
  { width: 100, height: 118 },
  { width: 100, height: 400 },
  { width: 151, height: 78 },
  { width: 300, height: 151 },
  { width: 300, height: 180 },
  { width: 100, height: 29 },
  { width: 150, height: 58 },
  { width: 226, height: 58 },
  { width: 300, height: 115 },
];

const calcRatio = ({ width, height }: Spec) => (width / height).toFixed(2);

const calcContainerSize = ({ width, height }: Spec) =>
  sanitizeHtmlSafe(`width: ${width}px; height: ${height}px`);

const FittedItemContainer: TemplateOnlyComponent<{
  Args: { spec: Spec };
  Blocks: { default: [] };
}> = <template>
  <div
    class={{cn
      'item'
      wide=(gt @spec.width 300)
      full-width=(gte @spec.width 400)
    }}
  >
    <div class='desc'>
      {{#if @spec.title}}<h4>{{@spec.title}}</h4>{{/if}}
      Aspect Ratio
      {{calcRatio @spec}},
      {{@spec.width}}px &times;
      {{@spec.height}}px
    </div>
    <CardContainer
      @displayBoundaries={{true}}
      class='card'
      style={{calcContainerSize @spec}}
    >
      {{yield}}
    </CardContainer>
  </div>
  <style scoped>
    .card {
      container-name: fitted-card;
      container-type: size;
      overflow: hidden;
    }
    .wide {
      grid-column: span 2;
    }
    .full-width {
      grid-column: -1 / 1;
    }
    .item {
      position: relative;
      padding-top: 50px;
      padding-inline: var(--boxel-sp);
      padding-bottom: var(--boxel-sp);
      background-color: var(--boxel-100);
    }
    .desc {
      position: absolute;
      top: 0;
      right: 0;
      padding: var(--boxel-sp-4xs);
      background-color: var(--boxel-light);
      border-left: var(--boxel-border-card);
      border-right: var(--boxel-border-card);
      border-bottom: var(--boxel-border-card);
      color: var(--boxel-450);
      font: var(--boxel-font-xs);
    }
    h4 {
      margin: 0;
      font-weight: 500;
    }
  </style>
</template>;

const PreviewTemplate: TemplateOnlyComponent<{
  Args: { specs: { title: string; items: Spec[] }[] };
  Blocks: { default: [] };
}> = <template>
  <div class='scroller' tabindex='0'>
    <h3>Standard Fitted Sizes</h3>
    {{#each @specs as |specGroup|}}
      <h3>{{specGroup.title}}</h3>
      {{#each specGroup.items as |spec|}}
        <FittedItemContainer @spec={{spec}}>
          {{yield}}
        </FittedItemContainer>
      {{/each}}
    {{/each}}
  </div>
  <style scoped>
    .scroller {
      max-height: 40vh;
      overflow-y: scroll;
      border: 2px solid var(--boxel-200);
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: var(--boxel-sp-xs);
    }
    h3 {
      grid-column: -1 / 1;
      font-weight: 500;
    }
  </style>
</template>;

export default class BasicFittedUsage extends Component {
  @tracked primary: string =
    'Primary: Singularity’s Echo – A Mind-Bending Sci-Fi Masterpiece';
  @tracked secondary: string = 'Secondary: Robert Fields';
  @tracked description: string =
    'Description: In an era hungry for originality, "Singularity’s Echo" emerges as a luminous beacon in the cosmic darkness—an audacious journey that redefines what viewers can expect from the genre. Directed by the elusive auteur Oruni Kilrain, this film harnesses the raw power of interstellar wonder and transforms it into a multilayered narrative tapestry. Blending heart-stirring drama with disorienting visuals, "Singularity’s Echo" reminds us that true cinematic frontiers remain ripe for exploration, stretching beyond the gravitational pull of safe storytelling.';
  @tracked thumbnailURL: string =
    'https://boxel-images.boxel.ai/app-assets/blog-posts/space-movie-thumb.jpeg';
  iconComponent: Icon = Captions;
  specs = [
    ...FITTED_FORMATS.flatMap((format) => ({
      title: format.name,
      items: format.specs,
    })),
    {
      title: 'More Sizes',
      items: OTHER_SIZES,
    },
  ];

  <template>
    <FreestyleUsage
      @name='BasicFitted'
      @description='Designed to render well inside a CSS container with container-name: fitted-card, container-type: size'
    >
      <:example>
        <PreviewTemplate @specs={{this.specs}}>
          <BasicFitted
            @primary={{this.primary}}
            @secondary={{this.secondary}}
            @description={{this.description}}
            @thumbnailURL={{this.thumbnailURL}}
            @iconComponent={{this.iconComponent}}
          />
        </PreviewTemplate>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='primary'
          @description='string to display as the primary text'
          @value={{this.primary}}
          @onInput={{fn (mut this.primary)}}
        />
        <Args.String
          @name='secondary'
          @description='string to display as the secondary text'
          @value={{this.secondary}}
          @onInput={{fn (mut this.secondary)}}
        />
        <Args.String
          @name='description'
          @description='string to display as the secondary text'
          @value={{this.description}}
          @onInput={{fn (mut this.description)}}
        />
        <Args.String
          @name='thumbnailURL'
          @description='URL of the thumbnail to display'
          @value={{this.thumbnailURL}}
          @onInput={{fn (mut this.thumbnailURL)}}
        />
        <Args.Component
          @name='iconComponent'
          @description='Component for the card type icon'
          @value={{this.iconComponent}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
