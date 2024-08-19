import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { provide } from 'ember-provide-consume-context';

import { DefaultFormatsContextName } from '@cardstack/runtime-common';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: BaseDef;
  };
}
export default class FittedFormatGallery extends Component<Signature> {
  @provide(DefaultFormatsContextName)
  get defaultFormat() {
    return { cardDef: 'fitted', fieldDef: 'fitted' };
  }

  @cached
  get renderedCard() {
    return this.args.card.constructor.getComponent(this.args.card);
  }

  <template>
    {{! template-lint-disable no-inline-styles }}
    <div class='item'>
      <div class='desc'>Aspect Ratio 1.0, 226px &times; 226px</div>
      <div class='card' style='width: 226px; height: 226px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 0.73, 164px &times; 224px</div>
      <div class='card' style='width: 164px; height: 224px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 0.91, 164px &times; 180px</div>
      <div class='card' style='width: 164px; height: 180px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 0.95, 140px &times; 148px</div>
      <div class='card' style='width: 140px; height: 148px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 0.94, 120px &times; 128px</div>
      <div class='card' style='width: 120px; height: 128px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 0.85, 100px &times; 118px</div>
      <div class='card' style='width: 100px; height: 118px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 0.2, 100px &times; 500px</div>
      <div class='card' style='width: 100px; height: 500px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 1.9, 151px &times; 78px</div>
      <div class='card' style='width: 151px; height: 78px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 1.99, 300px &times; 151px</div>
      <div class='card' style='width: 300px; height: 151px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 1.66, 300px &times; 180px</div>
      <div class='card' style='width: 300px; height: 180px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 3.4, 100px &times; 29px</div>
      <div class='card' style='width: 100px; height: 29px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 2.6, 150px &times; 58px</div>
      <div class='card' style='width: 150px; height: 58px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 3.9, 226px &times; 58px</div>
      <div class='card' style='width: 226px; height: 58px'>
        <this.renderedCard />
      </div>
    </div>
    <div class='item'>
      <div class='desc'>Aspect Ratio 2.6, 300px &times; 115px</div>
      <div class='card' style='width: 300px; height: 115px'>
        <this.renderedCard />
      </div>
    </div>

    <style>
      .card {
        /* this is how a border would appear around a card.
           note that a card is not supposed to draw its own border
         */
        box-shadow: 0 0 0 1px var(--boxel-light-500);
        height: 100%;
        overflow: hidden;
        border-radius: var(--boxel-border-radius);
        container-name: fitted-card;
        container-type: size;
      }
      .item {
        position: relative;
        padding: var(--boxel-sp);
        border-top: var(--boxel-border-card);
      }
      .desc {
        position: absolute;
        top: 0;
        right: 0;
        padding: var(--boxel-sp-4xs);
        border-left: var(--boxel-border-card);
        border-bottom: var(--boxel-border-card);
        color: var(--boxel-450);
        font: var(--boxel-font-xs);
      }
    </style>
  </template>
}
