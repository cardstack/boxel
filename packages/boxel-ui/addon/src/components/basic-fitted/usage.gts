import Captions from '@cardstack/boxel-icons/captions';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { FITTED_FORMATS } from '../../helpers.gts';
import type { Icon } from '../../icons.ts';
import CardContainer from '../card-container/index.gts';
import {
  type Spec,
  FittedUsagePreview,
} from '../fitted-card/usage-preview.gts';
import BasicFitted from './index.gts';

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
    {{! template-lint-disable no-inline-styles style-concatenation }}
    <FreestyleUsage @name='BasicFitted'>
      <:description>
        Designed to render well inside a CSS container with the following
        properties specified:
        <pre>
          .sample-container-class {
            container-name: fitted-card;
            container-type: size;
            width: /* ... */;
            height: /* ... */;
          }
        </pre>
      </:description>
      <:example>
        <FittedUsagePreview @specs={{this.specs}} as |spec|>
          <CardContainer
            @displayBoundaries={{true}}
            style='container-name: fitted-card; container-type: size; width: {{spec.width}}px; height: {{spec.height}}px'
          >
            <BasicFitted
              @primary={{this.primary}}
              @secondary={{this.secondary}}
              @description={{this.description}}
              @thumbnailURL={{this.thumbnailURL}}
              @iconComponent={{this.iconComponent}}
            />
          </CardContainer>
        </FittedUsagePreview>
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
          @description='Component for the thumbnail icon'
          @value={{this.iconComponent}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
