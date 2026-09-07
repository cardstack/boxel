import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';
import { tuneSpring } from 'test-app/lib/demo-tuning';

const quick = { damping: 26, stiffness: 320 };

/**
 * boxel-motion's list demo: a name crossing between two lists is one sprite
 * to the choreography — the new element carries the old one's bounds as its
 * counterpart — so one Move takes it from where it was to where it is, while
 * the columns it left and joined resize around it on the same spring.
 */
export class Lists extends Component {
  @tracked crew = ['Arden', 'Bex', 'Juno', 'Ines'];
  @tracked bench = ['Rook', 'Sable'];

  toBench = (name: string) => {
    this.crew = this.crew.filter((n) => n !== name);
    this.bench = [...this.bench, name].sort();
  };

  toCrew = (name: string) => {
    this.bench = this.bench.filter((n) => n !== name);
    this.crew = [...this.crew, name].sort();
  };

  <template>
    <div class="ex">
      <Choreo class="lists" as |c|>
        <div class="list" {{motion id="crew" role="column"}}>
          <span class="list-head">Crew</span>
          {{#each this.crew key="@identity" as |name|}}
            <button
              type="button"
              class="list-name"
              {{motion id=name role="name"}}
              {{on "click" (fn this.toBench name)}}
            >{{name}}</button>
          {{/each}}
        </div>
        <div class="list" {{motion id="bench" role="column"}}>
          <span class="list-head">Bench</span>
          {{#each this.bench key="@identity" as |name|}}
            <button
              type="button"
              class="list-name is-bench"
              {{motion id=name role="name"}}
              {{on "click" (fn this.toCrew name)}}
            >{{name}}</button>
          {{/each}}
        </div>

        <c.Parallel>
          {{! the names only translate — they never change size. @swap="none":
              this demo hides the leaver itself (the Hold below) and flies the
              new element as the one visible skin — the default crossfade
              would fade the flight instead of showing it. }}
          <c.Move
            @of={{c.kept "name"}}
            @spring={{tuneSpring "lists" quick "quick"}}
            @size={{false}}
            @swap="none"
          />
          {{! the columns only change height — they never move }}
          <c.Move
            @of={{c.moved "column"}}
            @spring={{tuneSpring "lists" quick "quick"}}
          />
          <c.Hold @of={{c.removed "name"}} @opacity={{0}} />
        </c.Parallel>
      </Choreo>
    </div>
  </template>
}
