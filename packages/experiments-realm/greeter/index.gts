import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// A deliberately tiny card package, so the thing being tested is the
// VERSIONING and not the card.
//
// Self-contained on purpose: it imports only from the base realm, so packing
// `greeter/` produces a Version with no imports that leave the pack. That is
// the property the CRM does not have yet, and it is what makes this the
// package to run the experiment against.
//
// v2 is BREAKING, on purpose and in the way that hurts most: `name` is gone
// and `person` takes its place. An instance holding `{ name: "Ada" }` still
// parses, still indexes, and renders a greeting addressed to nobody — which
// is exactly why a major has to be a decision somebody makes rather than a
// number that follows from a save.
export class Greeter extends CardDef {
  static displayName = 'Greeter';

  @field person = contains(StringField);
  @field mood = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Greeter) {
      return `Hi ${this.person ?? 'nobody'}!`;
    },
  });

  static isolated = class Isolated extends Component<typeof Greeter> {
    <template>
      <section class='greeter'>
        <p class='line'>Hi {{@model.person}}!</p>
        {{#if @model.mood}}
          <p class='mood'>feeling {{@model.mood}}</p>
        {{/if}}
        <p class='v'>greeter v2</p>
      </section>
      <style scoped>
        .greeter {
          padding: 1.5rem;
          font: 400 15px/1.5 system-ui, sans-serif;
        }
        .line {
          margin: 0;
          font-size: 1.5rem;
        }
        .mood {
          margin: 0.25rem 0 0;
          color: #666;
        }
        .v {
          margin: 0.25rem 0 0;
          font-family: ui-monospace, monospace;
          font-size: 0.75rem;
          color: #888;
        }
      </style>
    </template>
  };
}
