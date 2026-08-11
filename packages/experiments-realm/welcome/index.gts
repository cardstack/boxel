import { Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Greeter } from 'experiments/greeter';

// The cross-package dependency, at its hardest: this card EXTENDS a card that
// lives in another published Version. If the seal does not resolve, nothing
// here even loads — there is no partial success to mistake for working.
//
// The specifier is bare — `experiments/greeter` — and deliberately says
// nothing about which version. The answer is in this package's own sealed
// map, put there when it was published: `deck.dependencies` records that the
// author asked for `^2.0.0`, and `imports` records what that resolved to on
// the day it was sealed. A consumer pinning `welcome@1.0.0` therefore gets
// the greeter this was published against, not whichever one the realm holds
// now, which is the whole of `deck-a-package-resolves-through-its-own-map.md`.
export class Welcome extends Greeter {
  static displayName = 'Welcome';

  @field venue = contains(StringField);

  static isolated = class Isolated extends Component<typeof Welcome> {
    <template>
      <section class='welcome'>
        <p class='line'>Welcome, {{@model.person}}.</p>
        {{#if @model.venue}}
          <p class='venue'>at {{@model.venue}}</p>
        {{/if}}
        <p class='v'>welcome v1, extending greeter v2 through the seal</p>
      </section>
      <style scoped>
        .welcome {
          padding: 1.5rem;
          font: 400 15px/1.5 system-ui, sans-serif;
        }
        .line {
          margin: 0;
          font-size: 1.5rem;
        }
        .venue {
          margin: 0.25rem 0 0;
          color: #666;
        }
        .v {
          margin: 0.5rem 0 0;
          font-family: ui-monospace, monospace;
          font-size: 0.75rem;
          color: #888;
        }
      </style>
    </template>
  };
}
