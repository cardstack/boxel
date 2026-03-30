import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class HelloCard extends CardDef {
  static displayName = 'Hello Card';

  @field greeting = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: HelloCard) {
      return this.greeting ?? 'Hello World';
    },
  });

  static fitted = class Fitted extends Component<typeof HelloCard> {
    <template>
      <div class='hello-card' data-test-hello-card>
        <p data-test-greeting>{{if
            @model.greeting
            @model.greeting
            'Hello World'
          }}</p>
      </div>
      <style scoped>
        .hello-card {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof HelloCard> {
    <template>
      <article class='surface' data-test-hello-card>
        <h1 data-test-greeting>{{if
            @model.greeting
            @model.greeting
            'Hello World'
          }}</h1>
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
        }
      </style>
    </template>
  };
}
