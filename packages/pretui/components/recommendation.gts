// Pretui — Recommendation: the agent proposes one option with its confidence; you accept, or open the others.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { Collapse } from '../internal/agentic-chat';
import { Button } from './button';
import { Meter } from './meter';

// ── Recommendation ───────────────────────────────────────────────────────
// The agent has an opinion and the reader has to decide. The shape that
// makes that honest: ONE recommendation forward with its reasoning, its
// confidence as segments beside a word (Law 4 — never a bare percentage),
// and the alternatives one keystroke away rather than hidden.
//
// Swapping to an alternative is a state change the reader made, so it is
// announced through a polite live region — the original merely cross-faded
// the body, which tells a sighted reader something happened and a screen
// reader nothing at all.

export interface RecommendationOption {
  /** stable id — the {{#each}} key and the selection value */
  key: string;
  /** the full argument for this option */
  body: string;
  /** one-line form, for the alternatives drawer */
  short: string;
  /** confidence 0..3, rendered as the Meter's segments */
  level: number;
  /** the confidence word — always text beside the segments */
  label: string;
  /** hue override for the Meter; validated through the kit's allowlist */
  hue?: string;
  /** accept-button wording for this option (default 'Accept') */
  cta?: string;
}

export interface RecommendationSignature {
  Args: {
    /** what is being decided */
    question: string;
    /** the options, best first */
    options: RecommendationOption[];
    /** controlled selection key */
    selectedKey?: string;
    /** fires when the reader switches to another option */
    onSelect?: (option: RecommendationOption) => void;
    /** fires when the reader accepts the active option */
    onAccept?: (option: RecommendationOption) => void;
    /** the decision has already been taken (controlled) */
    accepted?: boolean;
    /** accepted-state wording (default 'Accepted') */
    acceptedLabel?: string;
    /** drawer trigger wording (default 'Alternatives') */
    alternativesLabel?: string;
  };
  Blocks: {
    /** rich body for the active option, replacing its `body` string */
    body: [option: RecommendationOption];
  };
  Element: HTMLDivElement;
}

export class Recommendation extends Component<RecommendationSignature> {
  @tracked private innerKey?: string;
  @tracked private innerAccepted = false;
  @tracked private drawerOpen = false;

  private drawerId = guidFor(this) + '-alts';

  get options(): RecommendationOption[] {
    return this.args.options ?? [];
  }
  get activeKey(): string {
    return this.args.selectedKey ?? this.innerKey ?? this.options[0]?.key ?? '';
  }
  get active(): RecommendationOption | undefined {
    return this.options.find((o) => o.key === this.activeKey) ?? this.options[0];
  }
  get others(): RecommendationOption[] {
    return this.options.filter((o) => o.key !== this.activeKey);
  }
  get accepted(): boolean {
    return this.args.accepted ?? this.innerAccepted;
  }
  get acceptLabel(): string {
    if (this.accepted) {
      return this.args.acceptedLabel ?? 'Accepted';
    }
    return this.active?.cta ?? 'Accept';
  }
  get alternativesLabel(): string {
    return this.args.alternativesLabel ?? 'Alternatives';
  }
  /** what the live region says when the active option changes */
  get announcement(): string {
    let option = this.active;
    if (!option) {
      return '';
    }
    return 'Showing: ' + option.short + ' — confidence ' + option.label;
  }

  select = (option: RecommendationOption) => {
    if (this.args.selectedKey === undefined) {
      this.innerKey = option.key;
    }
    this.innerAccepted = false;
    this.drawerOpen = false;
    this.args.onSelect?.(option);
  };

  accept = () => {
    let option = this.active;
    if (!option) {
      return;
    }
    this.innerAccepted = true;
    this.args.onAccept?.(option);
  };

  toggleDrawer = () => (this.drawerOpen = !this.drawerOpen);

  <template>
    <div
      class='pretui-reco'
      data-accepted={{if this.accepted 'true'}}
      data-test-pretui-recommendation
      ...attributes
    >
      <div class='pretui-reco-head'>
        <p class='pretui-reco-question'>{{@question}}</p>
        {{#if this.active}}
          <div class='pretui-reco-body'>
            {{#if (has-block 'body')}}
              {{yield this.active to='body'}}
            {{else}}
              {{this.active.body}}
            {{/if}}
          </div>
        {{/if}}
      </div>

      <span class='pretui-sr' role='status'>{{this.announcement}}</span>

      {{#if this.others.length}}
        <Collapse @open={{this.drawerOpen}} id={{this.drawerId}}>
          <div class='pretui-reco-drawer'>
            <p class='pretui-reco-drawer-cap' id='{{this.drawerId}}-cap'>Other
              options</p>
            <ul aria-labelledby='{{this.drawerId}}-cap'>
              {{#each this.others key='key' as |option|}}
                <li>
                  <button
                    type='button'
                    class='pretui-reco-alt'
                    data-test-pretui-recommendation-alt
                    {{on 'click' (fn this.select option)}}
                  >
                    <Meter
                      @level={{option.level}}
                      @label={{option.label}}
                      @hue={{option.hue}}
                    />
                    <span class='pretui-reco-alt-short'>{{option.short}}</span>
                  </button>
                </li>
              {{/each}}
            </ul>
          </div>
        </Collapse>
      {{/if}}

      <div class='pretui-reco-foot'>
        {{#if this.active}}
          <Meter
            @level={{this.active.level}}
            @label={{this.active.label}}
            @hue={{this.active.hue}}
          />
        {{/if}}
        <span class='pretui-reco-foot-actions'>
          {{#if this.others.length}}
            <Button
              @tone='neutral'
              @appearance='outlined'
              @size='s'
              aria-expanded={{if this.drawerOpen 'true' 'false'}}
              aria-controls={{this.drawerId}}
              data-test-pretui-recommendation-drawer
              {{on 'click' this.toggleDrawer}}
            >{{this.alternativesLabel}}</Button>
          {{/if}}
          <Button
            @size='s'
            @tone={{if this.accepted 'success' 'primary'}}
            @disabled={{unless this.active true}}
            data-test-pretui-recommendation-accept
            {{on 'click' this.accept}}
          >{{this.acceptLabel}}</Button>
        </span>
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-reco {
          width: 100%;
          overflow: hidden;
          border-radius: var(--radius-surface, 14px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.08)
          );
          container-type: inline-size;
        }
        .pretui-reco-head {
          padding: 12px 14px;
        }
        .pretui-reco-question {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .pretui-reco-body {
          margin-top: 6px;
          min-height: 40px;
          max-width: 62ch;
          font-size: var(--text-ui-md, 12.5px);
          line-height: 1.6;
          color: var(--muted-foreground);
        }
        .pretui-reco-drawer {
          background: var(--inset, var(--boxel-100));
          box-shadow: 0 -1px 0 var(--border);
          padding: 8px;
        }
        .pretui-reco-drawer-cap {
          margin: 0 0 4px;
          padding: 0 8px;
          font-size: 11px;
          font-weight: 500;
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-reco-drawer ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-reco-alt {
          display: flex;
          width: 100%;
          align-items: center;
          gap: 10px;
          min-height: 34px;
          padding: 6px 8px;
          border: 0;
          border-radius: 8px;
          background: none;
          font: inherit;
          font-size: var(--text-ui-md, 12.5px);
          text-align: left;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-reco-alt:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-reco-alt:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-reco-alt-short {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-reco-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          padding: 8px 12px;
          background: var(--inset, var(--boxel-100));
          box-shadow: 0 -1px 0 var(--border);
        }
        .pretui-reco-foot-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        @media (any-pointer: coarse) {
          .pretui-reco-alt {
            min-height: 44px;
          }
        }
      }
    </style>
  </template>
}
