import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import CardContainer from '../card-container/index.gts';
import BasicFitted from './index.gts';

export default class BasicFittedUsage extends Component {
  @tracked primary: string = 'The Primary';
  @tracked secondary: string = 'Secondary';
  @tracked description: string = 'This is the description. It is often longer';
  @tracked thumbnailURL: string = 'https://i.imgur.com/RZ0rsfxt.jpg';

  <template>
    <FreestyleUsage
      @name='BasicFitted'
      @description='Designed to render well inside a CSS container with container-name: fitted, container-type: size'
    >
      <:example>
        <div class='scroller' tabindex='0'>
          <div class='item'>
            <div class='desc'>Aspect Ratio 1.0, 226px &times; 226px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 226px; height: 226px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 0.73, 164px &times; 224px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 164px; height: 224px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 0.91, 164px &times; 180px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 164px; height: 180px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 0.95, 140px &times; 148px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 140px; height: 148px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 0.94, 120px &times; 128px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 120px; height: 128px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 0.85, 100px &times; 118px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 100px; height: 118px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 0.25, 100px &times; 400px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 100px; height: 400px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 1.9, 151px &times; 78px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 151px; height: 78px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 1.99, 300px &times; 151px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 300px; height: 151px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 1.66, 300px &times; 180px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 300px; height: 180px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 3.4, 100px &times; 29px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 100px; height: 29px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 2.6, 150px &times; 58px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 150px; height: 58px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 3.9, 226px &times; 58px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 226px; height: 58px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
          <div class='item'>
            <div class='desc'>Aspect Ratio 2.6, 300px &times; 115px</div>
            <CardContainer
              @displayBoundaries={{true}}
              class='card'
              style='width: 300px; height: 115px'
            >
              <BasicFitted
                @primary={{this.primary}}
                @secondary={{this.secondary}}
                @description={{this.description}}
                @thumbnailURL={{this.thumbnailURL}}
              />
            </CardContainer>
          </div>
        </div>
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
      </:api>
    </FreestyleUsage>
    <style>
      .scroller {
        max-height: 40vh;
        overflow-y: scroll;
        border: 2px inset var(--boxel-200);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: var(--boxel-sp-xs);
      }
      .card {
        container-name: fitted-card;
        container-type: size;
        overflow: hidden;
      }
      .item {
        position: relative;
        padding: var(--boxel-sp);
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
    </style>
  </template>
}
