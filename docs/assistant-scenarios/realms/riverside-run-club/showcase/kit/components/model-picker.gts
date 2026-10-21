// Pretui — ModelPicker: which model answers, what it costs, and how hard it thinks.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Popover } from './popover';
import { SegmentedControl } from './segmented-control';

export interface PickerModel {
  id: string;
  /** 'GPT-5.6 Terra' */
  label: string;
  /** 'OpenAI'; models group by it */
  provider?: string;
  /** 1–3: shown as $, $$, $$$ */
  cost?: number;
  /** a quieter line: 'fast', 'best for code', 'default' */
  note?: string;
}

export interface ModelPickerSignature {
  Args: {
    models: PickerModel[];
    /** the chosen model's id */
    value: string;
    onChange: (id: string) => void;
    /** reasoning effort, when the model offers it: 'low', 'medium', 'high' */
    efforts?: string[];
    effort?: string;
    onEffortChange?: (effort: string) => void;
    disabled?: boolean;
  };
  Element: HTMLSpanElement;
}

const dollars = (cost?: number) =>
  cost ? '$'.repeat(Math.min(Math.max(Math.round(cost), 1), 3)) : '';

/**
 * "GPT-5.6 Terra $$ ▾" in the composer's tools: a quiet trigger that opens
 * the models grouped by provider, each with its cost tier and a note, and
 * the effort switch when the model has one. Picking closes the panel.
 */
export class ModelPicker extends Component<ModelPickerSignature> {
  get current(): PickerModel | undefined {
    return this.args.models.find((m) => m.id === this.args.value);
  }
  get groups(): { provider: string; models: PickerModel[] }[] {
    let groups = new Map<string, PickerModel[]>();
    for (let model of this.args.models) {
      let key = model.provider ?? 'Models';
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups].map(([provider, models]) => ({ provider, models }));
  }
  get effortOptions() {
    return (this.args.efforts ?? []).map((e) => ({ value: e, label: e }));
  }
  dollars = dollars;
  isCurrent = (model: PickerModel) => model.id === this.args.value;
  pick = (model: PickerModel, close: () => void) => {
    this.args.onChange(model.id);
    close();
  };
  setEffort = (effort: string) => this.args.onEffortChange?.(effort);
  <template>
    <Popover @placement='top-start' @label='Model' ...attributes>
      <:trigger as |open toggle|>
        <button
          type='button'
          class='pretui-modelpick-trigger'
          aria-haspopup='true'
          aria-expanded={{if open 'true' 'false'}}
          disabled={{@disabled}}
          data-test-pretui-model-picker
          {{on 'click' toggle}}
        >
          <span class='pretui-modelpick-name'>{{if
              this.current
              this.current.label
              'Choose a model'
            }}</span>
          {{#if this.current.cost}}<span class='pretui-modelpick-cost'>{{this.dollars
                this.current.cost
              }}</span>{{/if}}
          <span class='pretui-modelpick-chevron' aria-hidden='true'></span>
        </button>
      </:trigger>
      <:default as |close|>
        <div class='pretui-modelpick-panel' data-test-pretui-model-picker-panel>
          {{#each this.groups as |group|}}
            <div class='pretui-modelpick-group' role='group' aria-label={{group.provider}}>
              <span class='pretui-modelpick-provider' aria-hidden='true'>{{group.provider}}</span>
              <ul class='pretui-modelpick-list' aria-label={{group.provider}}>
                {{#each group.models as |model|}}
                  <li>
                    <button
                      type='button'
                      class='pretui-modelpick-option'
                      aria-pressed={{if (this.isCurrent model) 'true' 'false'}}
                      data-test-pretui-model-option={{model.id}}
                      {{on 'click' (fn this.pick model close)}}
                    >
                      <span class='pretui-modelpick-check'>{{#if (this.isCurrent model)}}<StateGlyph @glyph='done' />{{/if}}</span>
                      <span class='pretui-modelpick-label'>{{model.label}}</span>
                      {{#if model.note}}<span class='pretui-modelpick-note'>{{model.note}}</span>{{/if}}
                      {{#if model.cost}}<span
                          class='pretui-modelpick-cost'
                          aria-label='cost tier {{model.cost}} of 3'
                        >{{this.dollars model.cost}}</span>{{/if}}
                    </button>
                  </li>
                {{/each}}
              </ul>
            </div>
          {{/each}}
          {{#if this.effortOptions.length}}
            <div class='pretui-modelpick-effort-row'>
              <span class='pretui-modelpick-provider'>Effort</span>
              <SegmentedControl
                @options={{this.effortOptions}}
                @value={{@effort}}
                @onValueChange={{this.setEffort}}
                @label='Reasoning effort'
              />
            </div>
          {{/if}}
        </div>
      </:default>
    </Popover>
    <style scoped>
      @layer PretComponent {
        /* a composer control: UI size, sans */
        .pretui-modelpick-trigger {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-modelpick-trigger:hover:not(:disabled) {
          background: var(--hover, var(--inset));
        }
        .pretui-modelpick-trigger:focus-visible,
        .pretui-modelpick-option:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-modelpick-cost {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-modelpick-chevron {
          width: 5px;
          height: 5px;
          margin-inline-start: 1px;
          border-inline-end: 1.5px solid currentColor;
          border-block-end: 1.5px solid currentColor;
          transform: translateY(-1px) rotate(45deg);
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-modelpick-panel {
          display: grid;
          gap: var(--step-8, 8px);
          min-width: 240px;
          max-height: 320px;
          padding: var(--step-4, 4px);
          overflow-y: auto;
        }
        .pretui-modelpick-group {
          display: grid;
          gap: 2px;
        }
        /* the provider names its group: a caption, not a lettered kicker */
        .pretui-modelpick-provider {
          padding: 2px var(--step-8, 8px);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 600;
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-modelpick-list {
          display: grid;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-modelpick-option {
          display: flex;
          align-items: baseline;
          gap: var(--step-8, 8px);
          width: 100%;
          min-height: 32px;
          padding: 7px var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          text-align: start;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-modelpick-option:hover {
          background: var(--hover, var(--inset));
        }
        /* the current model: done is ink with a check */
        .pretui-modelpick-check {
          width: 12px;
          color: var(--foreground);
        }
        .pretui-modelpick-label {
          font-weight: 600;
        }
        .pretui-modelpick-note {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-modelpick-option .pretui-modelpick-cost {
          margin-inline-start: auto;
        }
        .pretui-modelpick-effort-row {
          display: grid;
          gap: var(--step-4, 4px);
          padding: var(--step-8, 8px) 2px 2px;
          box-shadow: 0 -1px 0 var(--border);
        }
      }
    </style>
  </template>
}
