import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { Preset } from 'dialkit/store';
import { DialStore, mountControlRenderer } from 'dialkit/vanilla';
import { modifier } from 'ember-modifier';

import type { AnyDial, DialTune } from '../lib/dial';
import { preventSelect } from '../lib/pointer';
import { realmFile } from '../lib/realm-url';

/** dialkit's own theme, served by the realm beside the stages that use it */
const THEME = realmFile('asset/dialkit/theme.css');

/**
 * dialkit's vanilla control renderer, mounted into an element and fed from
 * the store: every store change re-renders the controls in place.
 */
const mountControls = modifier((element: HTMLElement, [dial]: [AnyDial]) => {
  const props = () => ({
    panelId: dial.panelId,
    controls: DialStore.getPanel(dial.panelId)?.controls ?? [],
    values: DialStore.getValues(dial.panelId),
  });
  const controls = mountControlRenderer(element, props());
  const stop = DialStore.subscribe(dial.panelId, () =>
    controls.update(props()),
  );
  return () => {
    stop();
    controls.destroy();
  };
});

/**
 * The panel: a header, a row of tunes, and the control tree.
 *
 * ## The stylesheet is dialkit's
 *
 * All of dialkit's ports render the same `dialkit-*` class names against one
 * shared theme stylesheet, so a panel that emits the same markup inherits the
 * entire visual design. These class names are dialkit's, verbatim, and the
 * theme is linked beside the panel. The controls themselves are dialkit's
 * vanilla renderer, so they carry no scope of this file's, and the few rules
 * here that reach them go through `:deep()`.
 *
 * One correction the theme needs: it gives `.dialkit-slider-handle` only
 * `top: 50%`. The centring translate and the resting scale live in dialkit's
 * React component's inline style, not in the CSS, so the handle's transform is
 * re-derived below.
 *
 * ## Characters and presets are not the same thing
 *
 * `@characters` are shipped in the source: named tunes the stage guarantees you
 * can always get back to. Presets are the store's, they are yours, and they
 * persist. They sit in one row because to a player they are one question — what
 * am I driving — but only one of them can be deleted, and only one of them
 * survives someone editing it.
 *
 * That last part is the store's design and it is the good one: while a preset
 * is active, `updateValues` writes every slider edit straight into it. So the
 * arc is load a character, move one number, and the thing you come back to is
 * the tune you ended up with.
 */
interface Signature {
  Args: {
    /** shipped tunes, always available, never editable in place */
    characters?: DialTune[];
    dial: AnyDial;
  };
}

export class DialPanel extends Component<Signature> {
  @tracked private copied = false;
  /** the save field is revealed rather than always present: it is the third
      thing anyone does with a panel, and it is a text input in a stage full of
      drag targets */
  @tracked private naming = false;
  @tracked private draft = '';

  theme = THEME;

  get characters() {
    return this.args.characters ?? [];
  }

  startNaming = () => {
    this.naming = true;
    this.draft = '';
  };

  cancelNaming = () => {
    this.naming = false;
  };

  onDraft = (event: Event) => {
    this.draft = (event.target as HTMLInputElement).value;
  };

  commitName = (event: Event) => {
    event.preventDefault();
    const name = this.draft.trim();
    if (name) {
      this.args.dial.savePreset(name);
    }
    this.naming = false;
  };

  wear = (character: DialTune) => {
    this.args.dial.setAll(character.values);
  };

  load = (preset: Preset) => {
    this.args.dial.loadPreset(preset.id);
  };

  /**
   * Deleting a preset must not also be a click on the chip that loads it. The
   * × sits inside the chip because that is where it reads, so the event has to
   * be stopped by hand — there is no nesting that gets this for free.
   */
  forget = (preset: Preset, event: Event) => {
    event.stopPropagation();
    this.args.dial.deletePreset(preset.id);
  };

  isActive = (preset: Preset) => this.args.dial.activePresetId === preset.id;

  presetClass = (preset: Preset) =>
    this.isActive(preset) ? 'dial-tune is-on' : 'dial-tune';

  copy = async () => {
    await navigator.clipboard?.writeText(this.args.dial.instruction);
    this.copied = true;
    setTimeout(() => (this.copied = false), 1400);
  };

  <template>
    <link rel='stylesheet' href={{this.theme}} />
    {{! `data-mode="inline"` is dialkit's own embedded mode: its theme sets
        `.dialkit-panel` to `position: fixed; z-index: 9999` because the panel
        normally floats over the app, and the inline attribute puts it back in
        flow. `.dialkit-panel-inner` is the element that carries the surface —
        the glass background, the border, the blur — so leaving it out gets a
        panel with no panel in it. }}
    <div
      class='dialkit-root dial-spike'
      data-mode='inline'
      {{on 'selectstart' preventSelect}}
    >
      <div class='dialkit-panel' data-mode='inline'>
        <div class='dialkit-panel-inner'>
          {{! dialkit's own header and title classes, so the type and the rule
              under it come from the package rather than approximate it }}
          <header class='dialkit-panel-header dial-spike-head'>
            <span
              class='dialkit-folder-title dial-spike-name'
            >{{@dial.name}}</span>
            <button
              type='button'
              class='dial-spike-btn'
              {{on 'click' @dial.reset}}
            >reset</button>
            <button
              type='button'
              class='dial-spike-btn'
              {{on 'click' this.copy}}
            >
              {{if this.copied 'copied' 'copy'}}
            </button>
          </header>

          {{#if this.characters.length}}
            <div class='dial-tunes'>
              {{#each this.characters key='name' as |character|}}
                <button
                  type='button'
                  class='dial-tune'
                  title={{character.note}}
                  {{on 'click' (fn this.wear character)}}
                >{{character.name}}</button>
              {{/each}}

              {{#each @dial.presets key='id' as |preset|}}
                {{! dialkit's markup, verbatim: the forget control rides inside
                    the preset chip, so the shared theme styles it }}
                <button
                  {{! template-lint-disable no-nested-interactive }}
                  type='button'
                  class={{this.presetClass preset}}
                  {{on 'click' (fn this.load preset)}}
                >
                  {{preset.name}}
                  <span
                    class='dial-tune-x'
                    role='button'
                    tabindex='0'
                    {{on 'click' (fn this.forget preset)}}
                  >×</span>
                </button>
              {{/each}}

              {{#if this.naming}}
                <form class='dial-tune-form' {{on 'submit' this.commitName}}>
                  <input
                    class='dial-tune-input'
                    aria-label='Preset name'
                    placeholder='name it'
                    value={{this.draft}}
                    {{on 'input' this.onDraft}}
                    {{on 'blur' this.cancelNaming}}
                  />
                </form>
              {{else}}
                <button
                  type='button'
                  class='dial-tune is-save'
                  {{on 'click' this.startNaming}}
                >save</button>
              {{/if}}
            </div>
          {{/if}}

          {{! `.dialkit-folder-inner` is dialkit's own control-row container: a
              flex column with a 6px gap. Using it rather than spacing the rows
              by hand is the same trade as the rest of this panel — the package
              decides what it looks like. }}
          <div class='dialkit-folder-inner'>
            <div {{mountControls @dial}}></div>
          </div>
        </div>
      </div>
    </div>
    <style scoped>
      .dial-spike {
        align-self: flex-start;
        width: 280px;
      }

      /* dialkit's own inner padding is `10px 12px 0 12px` — no bottom, because
         in dialkit the last thing in a panel is a folder that brings its own.
         This panel ends on a slider, so it gets even padding on all four
         sides. */
      .dial-spike .dialkit-panel-inner {
        padding: 14px;
      }

      /* ...and the row container's own bottom padding comes off, or the panel
         is 14px on three sides and 24px underneath */
      .dial-spike .dialkit-folder-inner {
        padding-bottom: 0;
      }

      .dial-spike :deep(.dialkit-slider-handle) {
        transform: translateY(-50%) scaleX(0.25);
        transition: transform 200ms var(--ease);
      }

      .dial-spike :deep(.dialkit-slider-active .dialkit-slider-handle) {
        transform: translateY(-50%) scaleX(1);
      }

      .dial-spike-head {
        align-items: center;
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }

      /* the title takes the slack and never wraps: the buttons are the fixed
         part of this row, and a two-line header pushes the whole panel out of
         shape */
      .dial-spike-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dial-spike-btn {
        background: color-mix(in srgb, var(--foreground) 8%, transparent);
        border: 0;
        border-radius: 6px;
        color: var(--subtle-foreground);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.08em;
        padding: 4px 8px;
      }

      .dial-spike-btn:hover {
        color: var(--foreground);
      }

      /* dialkit's theme is dark-only: every token in it is a white-on-black
         translucency. Dropped into a light page that is a black slab with the
         page showing round it.

         Overriding the TOKENS rather than the rules is the whole point of the
         package shipping tokens: the selectors underneath are untouched, so the
         panel keeps dialkit's design and only changes what it is made of.
         Inverting the translucencies (dark-on-light instead of light-on-dark)
         keeps the layering intact — a hovered row is still a step above its
         surface, a groove is still a step below it. */
      .choreo-site[data-theme='light'] .dialkit-root {
        --dial-surface: rgba(33, 29, 24, 0.06);
        --dial-surface-hover: rgba(33, 29, 24, 0.1);
        --dial-surface-active: rgba(33, 29, 24, 0.13);
        --dial-surface-subtle: rgba(33, 29, 24, 0.08);
        --dial-text-root: #211d18;
        --dial-text-section: rgba(33, 29, 24, 0.72);
        --dial-text-label: rgba(33, 29, 24, 0.72);
        --dial-text-focus: #211d18;
        --dial-text-primary: rgba(33, 29, 24, 0.95);
        --dial-text-secondary: rgba(33, 29, 24, 0.62);
        --dial-text-tertiary: rgba(33, 29, 24, 0.42);
        --dial-border: rgba(33, 29, 24, 0.12);
        --dial-border-hover: rgba(33, 29, 24, 0.2);
        --dial-glass-bg: #f7f3ec;
        --dial-dropdown-bg: #efe9df;
        --dial-shadow: 0 8px 28px rgba(33, 29, 24, 0.14);
        --dial-shadow-collapsed: 0 4px 14px rgba(33, 29, 24, 0.1);
        --dial-shadow-dropdown: 0 8px 22px rgba(33, 29, 24, 0.14);
      }

      .dial-spike :deep(.dialkit-folder-header) {
        border-radius: 5px;
        margin: 0 -4px;
        padding: 0 4px;
      }

      .dial-spike :deep(.dialkit-folder-header:hover) {
        background: color-mix(in srgb, var(--foreground) 5%, transparent);
      }

      /* a nested folder's rows are already inside one .dialkit-folder-inner,
         whose bottom padding this panel zeroes out at the top level. Put it
         back for the inner ones only, or every folder's last slider sits on the
         divider. */
      .dial-spike :deep(.dialkit-folder .dialkit-folder-inner) {
        padding-bottom: 8px;
      }

      .dial-tunes {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 12px;
      }

      .dial-tune {
        align-items: center;
        background: color-mix(in srgb, var(--foreground) 7%, transparent);
        border: 1px solid transparent;
        border-radius: 999px;
        color: var(--subtle-foreground);
        cursor: pointer;
        display: inline-flex;
        font-family: var(--font-mono);
        font-size: 10px;
        gap: 4px;
        letter-spacing: 0.04em;
        padding: 3px 9px;
        transition:
          background 160ms var(--ease),
          border-color 160ms var(--ease),
          color 160ms var(--ease);
      }

      .dial-tune:hover {
        background: color-mix(in srgb, var(--foreground) 13%, transparent);
        color: var(--foreground);
      }

      /* the ACTIVE preset, which is the one the store is writing your edits
         into. Marked rather than merely selected, because the difference
         matters: move a slider now and this chip is what changed. */
      .dial-tune.is-on {
        background: color-mix(in srgb, var(--copper) 16%, transparent);
        border-color: color-mix(in srgb, var(--copper) 42%, transparent);
        color: var(--copper-ink);
      }

      .dial-tune.is-save {
        border-style: dashed;
        border-color: color-mix(in srgb, var(--foreground) 22%, transparent);
        background: transparent;
      }

      .dial-tune-x {
        color: var(--subtle-foreground);
        font-size: 12px;
        line-height: 1;
        opacity: 0.5;
      }

      .dial-tune-x:hover {
        color: var(--primary-ink);
        opacity: 1;
      }

      .dial-tune-form {
        display: inline-flex;
      }

      .dial-tune-input {
        background: color-mix(in srgb, var(--foreground) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--copper) 42%, transparent);
        border-radius: 999px;
        color: var(--foreground);
        font-family: var(--font-mono);
        font-size: 10px;
        outline: none;
        padding: 3px 9px;
        width: 92px;
      }
    </style>
  </template>
}
