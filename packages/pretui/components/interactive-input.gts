// Pretui — InteractiveInput: an agent-asked question answered with options or free text.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

// ── InteractiveInput ─────────────────────────────────────────────────────
// The agent needs a value before it can continue, and the whole point of the
// pattern is that it asks with a TYPED picker rather than free text: the
// answer is one of a known set, so the reader chooses instead of spelling.
// Answering does not resume anything — it arms an explicit "Re-run with X",
// because a value that silently restarts a run is a value you cannot review.
//
// The picker is a real `<fieldset>` of native radio inputs. That is not
// pedantry: it is where arrow-key navigation, Home/End, the grouped
// announcement ("Accent colour, 2 of 5") and the `:checked` styling hook all
// come from, none of which the swatch-div original had. Callers who need a
// picker this shape cannot express (a date, a card reference) replace the
// whole control through the `<:picker>` block.

export interface InteractiveInputOption {
  /** the value handed back to `@onValueChange` and shown in the re-run CTA */
  value: string;
  /** the face; defaults to the value */
  label?: string;
  /**
   * a colour to paint as a swatch beside the label. Caller strings reaching
   * CSS go through the kit-wide `cssValue` allowlist — a rejected value
   * simply loses its swatch, it never becomes a declaration.
   */
  swatch?: string;
}

export interface InteractiveInputSignature {
  Args: {
    /** the tier verb; 'INPUT' by default, matching the WorkItem grammar */
    verb?: string;
    /** what is being asked, e.g. 'Pick the accent for the callout' */
    prompt: string;
    /** optional second line of context under the prompt */
    detail?: string;
    /** the typed choices; omit and supply `<:picker>` instead */
    options?: InteractiveInputOption[];
    /** controlled selection */
    value?: string;
    /** starting selection when uncontrolled */
    defaultValue?: string;
    /** fires with the newly picked value */
    onValueChange?: (value: string) => void;
    /** fires when the reader commits — the re-run */
    onRerun?: (value: string) => void;
    /**
     * settled state. Once `answered`, the picker is disabled and the block
     * reads as a receipt rather than a live request — the quiet settle the
     * attention grammar asks for.
     */
    answered?: boolean;
    /** what the settled receipt says (default 're-executed') */
    answeredLabel?: string;
    /** CTA wording; receives the picked value (default 'Re-run with X') */
    rerunLabel?: (value: string) => string;
  };
  Blocks: {
    /** replaces the built-in radio picker; receives the current value and a
     * setter, so a custom control still reports through the same channel */
    picker: [value: string, setValue: (v: string) => void];
  };
  Element: HTMLDivElement;
}

export class InteractiveInput extends Component<InteractiveInputSignature> {
  @tracked private innerValue?: string;

  private groupName = guidFor(this) + '-choice';

  get options(): InteractiveInputOption[] {
    return this.args.options ?? [];
  }
  get value(): string {
    return (
      this.args.value ??
      this.innerValue ??
      this.args.defaultValue ??
      this.options[0]?.value ??
      ''
    );
  }
  get verb(): string {
    return this.args.verb ?? 'INPUT';
  }
  get answered(): boolean {
    return this.args.answered ?? false;
  }
  get answeredLabel(): string {
    return this.args.answeredLabel ?? 're-executed';
  }
  get rerunText(): string {
    let value = this.value;
    if (this.args.rerunLabel) {
      return this.args.rerunLabel(value);
    }
    return value ? 'Re-run with ' + value : 'Re-run';
  }
  get rows(): {
    value: string;
    label: string;
    checked: boolean;
    style: ReturnType<typeof cssStyleFrom>;
  }[] {
    return this.options.map((option) => ({
      value: option.value,
      label: option.label ?? option.value,
      checked: option.value === this.value,
      style: cssStyleFrom([cssDeclaration('--pretui-swatch', option.swatch)]),
    }));
  }

  setValue = (next: string) => {
    if (this.args.value === undefined) {
      this.innerValue = next;
    }
    this.args.onValueChange?.(next);
  };

  pick = (value: string) => this.setValue(value);

  rerun = () => this.args.onRerun?.(this.value);

  <template>
    <div
      class='pretui-iinput'
      data-answered={{if this.answered 'true'}}
      data-test-pretui-interactive-input
      ...attributes
    >
      <div class='pretui-iinput-head'>
        <span class='pretui-iinput-verb'>{{this.verb}}</span>
        <span class='pretui-iinput-prompt'>{{@prompt}}</span>
        {{#if this.answered}}
          <span class='pretui-iinput-settled'>{{this.answeredLabel}}</span>
        {{/if}}
      </div>
      {{#if @detail}}
        <p class='pretui-iinput-detail'>{{@detail}}</p>
      {{/if}}

      <div class='pretui-iinput-body'>
        {{#if (has-block 'picker')}}
          {{yield this.value this.setValue to='picker'}}
        {{else}}
          <fieldset class='pretui-iinput-set' disabled={{if this.answered true}}>
            <legend class='pretui-sr'>{{@prompt}}</legend>
            {{#each this.rows key='value' as |row|}}
              <label class='pretui-iinput-opt'>
                <input
                  type='radio'
                  name={{this.groupName}}
                  value={{row.value}}
                  checked={{if row.checked true}}
                  {{on 'change' (fn this.pick row.value)}}
                />
                <span class='pretui-iinput-swatch' style={{row.style}}></span>
                <span class='pretui-iinput-face'>{{row.label}}</span>
              </label>
            {{/each}}
          </fieldset>
        {{/if}}
      </div>

      {{#unless this.answered}}
        <div class='pretui-iinput-foot'>
          <Button
            @size='s'
            @disabled={{unless this.value true}}
            {{on 'click' this.rerun}}
            data-test-pretui-interactive-input-rerun
          >{{this.rerunText}}</Button>
        </div>
      {{/unless}}
    </div>

    <style scoped>
      .pretui-iinput {
        display: flex;
        flex-direction: column;
        gap: var(--space-3, 8px);
        padding: var(--space-3, 9px) var(--space-4, 11px);
        border-radius: 10px;
        background: linear-gradient(
          180deg,
          color-mix(
            in oklch,
            var(--pretui-attention, var(--boxel-fuschia)) 7%,
            var(--card)
          ),
          var(--card) 55%
        );
        box-shadow:
          0 0 0 1px
            color-mix(
              in oklch,
              var(--pretui-attention, var(--boxel-fuschia)) 55%,
              var(--border)
            ),
          0 2px 10px
            color-mix(
              in oklch,
              var(--pretui-attention, var(--boxel-fuschia)) 12%,
              transparent
            );
        font-size: var(--text-ui-md, 12.5px);
      }
      /* settled: the attention hue is reserved for "a human must act now",
         so an answered block gives it back */
      .pretui-iinput[data-answered] {
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .pretui-iinput-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }
      .pretui-iinput-verb {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: var(--pretui-attention-ink, var(--pretui-attention, var(--boxel-fuschia)));
        flex: none;
      }
      .pretui-iinput[data-answered] .pretui-iinput-verb {
        color: var(--muted-foreground);
      }
      .pretui-iinput-prompt {
        font-weight: 600;
        min-width: 0;
      }
      .pretui-iinput-settled {
        margin-left: auto;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-iinput-detail {
        margin: 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .pretui-iinput-set {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0;
        padding: 0;
        border: 0;
        min-inline-size: 0;
      }
      .pretui-iinput-opt {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font-size: var(--text-ui-sm, 11.5px);
        cursor: pointer;
      }
      .pretui-iinput-set:disabled .pretui-iinput-opt {
        cursor: default;
        opacity: 0.75;
      }
      .pretui-iinput-opt input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      .pretui-iinput-swatch {
        width: 12px;
        height: 12px;
        border-radius: 4px;
        flex: none;
        background: var(--pretui-swatch, var(--muted-foreground));
        box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.18);
      }
      /* selection is never colour alone — the checked pill also gains weight
         and a ring, so it survives greyscale */
      .pretui-iinput-opt:has(input:checked) {
        font-weight: 600;
        background: color-mix(
          in oklch,
          var(--primary) 10%,
          var(--card)
        );
        box-shadow:
          0 0 0 1px
            color-mix(in oklch, var(--primary) 55%, var(--border)),
          inset 0 0 0 1px
            color-mix(in oklch, var(--primary) 20%, transparent);
      }
      .pretui-iinput-opt:has(input:focus-visible) {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-iinput-foot {
        display: flex;
        justify-content: flex-end;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      /* coarse pointers get a 44px hit target without changing the fine one */
      @media (any-pointer: coarse) {
        .pretui-iinput-opt {
          min-height: 44px;
          padding: 0 14px;
        }
      }
    </style>
  </template>
}
