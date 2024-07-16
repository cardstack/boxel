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
      <div class='item'>
        <div class='desc'>Strip thumbnail (226px x 40px)<span
            class='highlight'
          >*</span></div>
        <div class='strip thumbnail' data-test-viewport='strip'>
          <@fields.card />
        </div>
        <div class='remark'><span class='highlight'>*</span>
          Note that I specifically overrode the design docs for the "strip"
          style, as they don't take into account the edit format for an embedded
          card. In this format we need to fit a strip style card into a 40px
          tall space. Our design docs will need to reflect this (or we need to
          change how the edit format's form looks.)
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
        .strip {
          height: 40px;
          width: 226px;
        }
        .remark {
          margin-top: 1rem;
          font: 300 var(--boxel-font-xs);
        }
        .highlight {
          color: fuchsia;
          font-weight: bold;
        }
        .thumbnail {
          /* this is a whacky background color so that we can see from visual inspection 
             if the embedded card doesn't use all the space that has been yielded to it
          */
          background-color: fuchsia;
          /* this is how a border would appear around a card.
             note that a card is not supposed to draw its own border 
          */
          box-shadow: 0 0 0 1px var(--boxel-light-500);
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
