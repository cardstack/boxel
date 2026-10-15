import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { DemoLab } from '../lib/lab';
import { DialPanel } from './dial-panel';

interface Signature {
  Args: {
    /** runs the demo's stage again from the start */
    onReplay: () => void;
    /** the demo's lab key, from `labSlug` */
    slug: string;
    /** the demo's title, which names the panel; the slug when it has none */
    title?: string;
  };
  Element: HTMLElement;
}

/**
 * The demo lab: a DialKit panel over every value the demo declares through
 * `demoTuning`, with the demo's authored looks as its shipped tunes and a
 * replay for the stage beside it. An edit reaches the demo as it renders,
 * and motion already running takes the new timing where it is; replay runs
 * the demo from the start with the new values.
 */
export class LabPanel extends Component<Signature> {
  readonly lab = new DemoLab(this.args.slug, this.title);

  get title(): string {
    return this.args.title || this.args.slug;
  }

  willDestroy() {
    super.willDestroy();
    this.lab.teardown();
  }

  <template>
    <section
      class='lab'
      aria-label='Tune {{this.title}} with DialKit'
      data-demo-lab={{@slug}}
      ...attributes
    >
      <DialPanel @dial={{this.lab.dial}} @characters={{this.lab.presets}} />
      <div class='lab-foot'>
        <button type='button' class='lab-replay' {{on 'click' @onReplay}}>
          Replay ↻
        </button>
        <p class='lab-note'>
          These values feed the live demo as you move them. Wear a tune, or
          replay to see the whole motion from the start. Copy puts your values
          on the clipboard.
        </p>
      </div>
    </section>
    <style scoped>
      .lab {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 280px;
        max-width: 100%;
      }

      .lab-foot {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .lab-replay {
        align-self: flex-start;
        padding: 6px 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink);
        background: var(--bg-elev);
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        cursor: pointer;
      }

      @media (hover: hover) {
        .lab-replay:hover {
          border-color: var(--copper);
        }
      }

      .lab-note {
        margin: 0;
        font-size: 0.82rem;
        color: var(--ink-faint);
      }
    </style>
  </template>
}
