import { Choreo } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneSpring } from '../lib/tuning';

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
    <div class='ex'>
      <Choreo class='lists' as |c|>
        <div class='list' {{motion id='crew' role='column'}}>
          <span class='list-head'>Crew</span>
          {{#each this.crew key='@identity' as |name|}}
            <button
              type='button'
              class='list-name'
              {{motion id=name role='name'}}
              {{on 'click' (fn this.toBench name)}}
            >{{name}}</button>
          {{/each}}
        </div>
        <div class='list' {{motion id='bench' role='column'}}>
          <span class='list-head'>Bench</span>
          {{#each this.bench key='@identity' as |name|}}
            <button
              type='button'
              class='list-name is-bench'
              {{motion id=name role='name'}}
              {{on 'click' (fn this.toCrew name)}}
            >{{name}}</button>
          {{/each}}
        </div>

        <c.Parallel>
          {{! the names only translate — they never change size. @swap="none":
              this demo hides the leaver itself (the Hold below) and flies the
              new element as the one visible skin — the default crossfade
              would fade the flight instead of showing it. }}
          <c.Move
            @of={{c.kept 'name'}}
            @spring={{tuneSpring 'lists' quick 'quick'}}
            @size={{false}}
            @swap='none'
          />
          {{! the columns only change height — they never move }}
          <c.Move
            @of={{c.moved 'column'}}
            @spring={{tuneSpring 'lists' quick 'quick'}}
          />
          <c.Hold @of={{c.removed 'name'}} @opacity={{0}} />
        </c.Parallel>
      </Choreo>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .lists {
        /* anchored to the top of the stage: a growing column then only pushes its
           own bottom edge down, so nothing above it shifts while names are in flight */
        align-self: start;
        margin-top: 26px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-items: start;
        gap: 18px;
        width: min(88%, 360px);
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        /* Content-driven, so a column is exactly as tall as it needs to be and can
           never overflow — the height change is animated (see the `column` Move), so
           it grows and shrinks instead of jumping. */
        min-height: 132px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--bg-elev);
      }

      .list-head {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
        margin-bottom: 4px;
      }

      .list-name {
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        padding: 8px 10px;
        background: var(--bg-spot);
        color: var(--ink);
        font: 13px var(--font);
        text-align: left;
        cursor: pointer;
      }

      .list-name.is-bench {
        border-color: rgba(228, 163, 90, 0.4);
        color: var(--copper-ink);
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneSpring('lists', quick, 'quick');

export class ListsDemo extends GalleryDemo {
  static stage = Lists;
}
