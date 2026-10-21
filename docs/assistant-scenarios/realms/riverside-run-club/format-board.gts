// Every Riverside card in every format, at the sizes the assistant uses:
// atoms in a sentence (its pills), fitted at strip, tile and poster sizes
// (its question choices and fitted blocks), and embedded (its inline
// embeds). The board for checking a design change at a glance.
import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';

export class FormatBoard extends CardDef {
  static displayName = 'Format board';
  static icon = LayoutGridIcon;
  @field title = contains(StringField);
  @field cards = linksToMany(CardDef);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: FormatBoard) {
      return this.title ?? 'Format board';
    },
  });

  static isolated = class Isolated extends Component<typeof FormatBoard> {
    <template>
      <article class='board'>
        <h1>{{@model.title}}</h1>
        <section>
          <h2>Atom, as a pill in a sentence</h2>
          <p class='sentence'>
            The assistant names
            {{#each @fields.cards as |Card|}}
              <span class='pill'><Card @format='atom' /></span>
            {{/each}}
            in its answers.
          </p>
        </section>
        <section>
          <h2>Fitted, strip 260 × 40</h2>
          <div class='row'>
            {{#each @fields.cards as |Card|}}
              <div class='frame strip'><Card @format='fitted' /></div>
            {{/each}}
          </div>
        </section>
        <section>
          <h2>Fitted, the reply's block 400 × 88</h2>
          <div class='row'>
            {{#each @fields.cards as |Card|}}
              <div class='frame block'><Card @format='fitted' /></div>
            {{/each}}
          </div>
        </section>
        <section>
          <h2>Fitted, a question's choice 150 × 200</h2>
          <div class='row'>
            {{#each @fields.cards as |Card|}}
              <div class='frame choice'><Card @format='fitted' /></div>
            {{/each}}
          </div>
        </section>
        <section>
          <h2>Fitted, badge 120 × 120</h2>
          <div class='row'>
            {{#each @fields.cards as |Card|}}
              <div class='frame badge'><Card @format='fitted' /></div>
            {{/each}}
          </div>
        </section>
        <section>
          <h2>Embedded, at the panel's width</h2>
          <div class='column'>
            {{#each @fields.cards as |Card|}}
              <div class='frame embed'><Card @format='embedded' /></div>
            {{/each}}
          </div>
        </section>
      </article>
      <style scoped>
        .board {
          padding: 32px;
          display: flex;
          flex-direction: column;
          gap: 28px;
          background: #2a2633;
          color: #e8e4f0;
          font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
        }
        h1 {
          margin: 0;
          font-size: 22px;
        }
        h2 {
          margin: 0 0 10px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #a8a2ba;
        }
        .sentence {
          margin: 0;
          max-width: 400px;
          font-size: 14px;
          line-height: 22px;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          height: 18px;
          padding: 0 8px;
          vertical-align: 1px;
          border-radius: 8px;
          background: #ffffff;
          color: #0d1522;
          font-size: 12.5px;
          font-weight: 600;
          line-height: 18px;
          overflow: hidden;
        }
        .pill > :deep(*) {
          min-width: 0;
          background: none;
          box-shadow: none;
          border: 0;
          padding: 0;
          font: inherit;
          color: inherit;
        }
        .row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }
        .column {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-width: 400px;
        }
        .frame {
          display: grid;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 0 0 1px #4a4458;
        }
        .frame > :deep(*) {
          height: 100%;
          border-radius: 0;
        }
        .strip {
          width: 260px;
          height: 40px;
        }
        .block {
          width: 400px;
          height: 88px;
        }
        .choice {
          width: 150px;
          height: 200px;
        }
        .badge {
          width: 120px;
          height: 120px;
        }
        .embed > :deep(*) {
          height: auto;
        }
      </style>
    </template>
  };
}
