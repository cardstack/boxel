export const viewCardDemoCardSource = `
  import { action } from '@ember/object';
  import { on } from '@ember/modifier';
  import {
    CardDef,
    field,
    contains,
    Component,
  } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class ViewCardDemo extends CardDef {
    static displayName = 'View Card Demo';

    @field title = contains(StringField);
    @field targetCardURL = contains(StringField);

    static isolated = class Isolated extends Component<typeof this> {
      @action openTarget() {
        let viewCard = this.args.viewCard;
        let target = this.args.model.targetCardURL;

        if (!viewCard || !target) {
          return;
        }

        try {
          viewCard(new URL(target));
        } catch {
          // Intentionally swallow parsing errors to avoid breaking the card.
        }
      }

      <template>
        <article data-test-view-card-demo>
          <header>
            <h2 data-test-view-card-demo-title>{{@model.title}}</h2>
          </header>
          <p data-test-view-card-demo-target>{{@model.targetCardURL}}</p>
          <button
            type="button"
            {{on "click" this.openTarget}}
            data-test-view-card-demo-button
          >
            View linked card
          </button>
        </article>
      </template>
    };
  }
`;
