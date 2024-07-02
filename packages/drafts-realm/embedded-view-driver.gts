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
      {{#if @model.card}}
        <div class='item'>
          <div class='desc'>Row thumbnail (226px x 62px)</div>
          <div class='row thumbnail' data-test-viewport='row'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>Small thumbnail (164px x 224px)</div>
          <div class='small thumbnail' data-test-viewport='small'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>Medium thumbnail (195px x 224px)</div>
          <div class='medium thumbnail' data-test-viewport='medium'>
            <@fields.card />
          </div>
        </div>
        <div class='item'>
          <div class='desc'>Large thumbnail (350px x 250px)</div>
          <div class='large thumbnail' data-test-viewport='large'>
            <@fields.card />
          </div>
        </div>
      {{/if}}
      <style>
        .small {
          width: 164px;
          height: 224px;
        }
        .medium {
          width: 195px;
          height: 224px;
        }
        .large {
          width: 350px;
          height: 250px;
        }
        .row {
          width: 226px;
          height: 62px;
        }
        .thumbnail {
          /* this is a whacky background color so that we can see from visual inspection 
             if the embedded card doesn't use all the space that has been yielded to it
          */
          background-color: fuchsia;
          overflow: hidden;
        }
        .item {
          margin: 1rem;
        }
        .desc {
          padding-top: 1rem;
        }
      </style>
    </template>
  };
}
