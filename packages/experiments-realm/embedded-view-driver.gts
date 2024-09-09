import {
  field,
  Component,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';

export class EmbeddedViewDriver extends CardDef {
  @field card = linksTo(CardDef);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      {{! template-lint-disable no-inline-styles }}
      <div class='group'>
        <div class='header'>Aspect ratio &lt;= 1.0</div>
        <div class='item'>
          <div class='desc'>AR 1.0: 226px x 226px</div>
          <div class='card' style='width: 226px; height: 226px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 0.73: 164px x 224px</div>
          <div class='card' style='width: 164px; height: 224px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 0.91: 164px x 180px</div>
          <div class='card' style='width: 164px; height: 180px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 0.95: 140px x 148px</div>
          <div class='card' style='width: 140px; height: 148px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 0.94: 120px x 128px</div>
          <div class='card' style='width: 120px; height: 128px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 0.85: 100px x 118px</div>
          <div class='card' style='width: 100px; height: 118px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 0.2: 100px x 500px</div>
          <div class='card' style='width: 100px; height: 500px'>
            <@fields.card />
          </div>
        </div>
      </div>

      <div class='group'>
        <div class='header'>1.0 &lt; Aspect ratio &lt; 2.0</div>
        <div class='item'>
          <div class='desc'>AR 1.9: 151px x 78px</div>
          <div class='card' style='width: 151px; height: 78px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 1.99: 300px x 151px</div>
          <div class='card' style='width: 300px; height: 151px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 1.66: 300px x 180px</div>
          <div class='card' style='width: 300px; height: 180px'>
            <@fields.card />
          </div>
        </div>
      </div>

      <div class='group'>
        <div class='header'>Aspect ratio &gt; 2.0</div>
        <div class='item'>
          <div class='desc'>AR 3.4: 100px x 29px</div>
          <div class='card' style='width: 100px; height: 29px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 2.6: 150px x 58px</div>
          <div class='card' style='width: 150px; height: 58px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 3.9: 226px x 58px</div>
          <div class='card' style='width: 226px; height: 58px'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>AR 2.6: 300px x 115px</div>
          <div class='card' style='width: 300px; height: 115px'>
            <@fields.card />
          </div>
        </div>
      </div>

      <style scoped>
        .card {
          /* this is how a border would appear around a card.
             note that a card is not supposed to draw its own border
          */
          box-shadow: 0 0 0 1px var(--boxel-light-500);
          overflow: hidden;
          border-radius: var(--boxel-border-radius);
        }
        .group {
          margin: 2rem;
        }
        .header {
          font: 700 var(--boxel-font-lg);
        }
        .item {
          padding-bottom: 1rem;
        }
        .desc {
          padding-top: 1rem;
        }
      </style>
    </template>
  };
}
