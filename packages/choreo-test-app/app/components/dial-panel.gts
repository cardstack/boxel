import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { Preset } from 'dialkit/store';
import DialNativeControls from 'test-app/components/dial-native-controls';
import type { AnyDial, DialTune } from 'test-app/lib/dial';
import { preventSelect } from 'test-app/lib/pointer';

/**
 * The panel: a header, a row of tunes, and the control tree.
 *
 * dialkit's React port is 4,506 lines across twenty controls, and 1,654 of
 * those are the timeline this repo should not take — Choreo seeks real
 * animations, dialkit's timeline re-derives spring maths to approximate one.
 * So this draws the smallest thing that can answer the question: can you tune
 * a live Choreo score, and a live physics loop, from a dialkit store.
 *
 * ## The stylesheet claim, tested
 *
 * All four of dialkit's ports render the same `dialkit-*` class names against
 * one shared 2,221-line `theme.css`. If that is true, an Ember port that emits
 * the same markup inherits the entire visual design for free — which is the
 * single biggest reason a fifth port is an afternoon rather than a fortnight.
 * These class names are dialkit's, verbatim, and `dialkit/styles.css` is
 * imported by the stage. Whether it actually looks right is the test.
 *
 * The answer, after Hang and Drift: mostly, with one caveat worth keeping. The
 * slider handle gets `top: 50%` from the stylesheet and nothing else — its
 * centring translate and its resting scale live in the React component's inline
 * `style` and `animate` props, not in the CSS. So a port inherits the design
 * and still has to re-derive the handful of values React kept in JavaScript.
 *
 * ## Where this is cheaper than React
 *
 * `Slider.tsx` is 432 lines, the largest control in the port, and most of it is
 * hand-rolled pointer maths: pointer capture, a drag origin, a delta, a
 * rubber-band at the ends. We own a drag library. `{{motion drag="x"}}` gives
 * us the gesture, so the slider in `dial-controls.gts` is the same control in a
 * fraction of the code — and it is the one place a Choreo port has a real
 * advantage over the ports that came before it.
 *
 * ## Characters and presets are not the same thing
 *
 * `@characters` are shipped in the source: named cars the stage guarantees you
 * can always get back to. Presets are the store's, they are yours, and they
 * persist. They sit in one row because to a player they are one question — what
 * am I driving — but only one of them can be deleted, and only one of them
 * survives someone editing it.
 *
 * That last part is the store's design and it is the good one: while a preset
 * is active, `updateValues` writes every slider edit straight into it. So the
 * arc is load a character, move one number, and the thing you come back to is
 * the car you ended up with.
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
    {{! `data-mode="inline"` is dialkit's own embedded mode: its theme sets
        `.dialkit-panel` to `position: fixed; z-index: 9999` because the panel
        normally floats over the app, and the inline attribute puts it back in
        flow. `.dialkit-panel-inner` is the element that carries the surface —
        the glass background, the border, the blur — so leaving it out gets a
        panel with no panel in it. }}
    <div
      class="dialkit-root dial-spike"
      data-mode="inline"
      {{on "selectstart" preventSelect}}
    >
      <div class="dialkit-panel" data-mode="inline">
        <div class="dialkit-panel-inner">
          {{! dialkit's own header and title classes, so the type and the rule
              under it come from the package rather than approximate it }}
          <header class="dialkit-panel-header dial-spike-head">
            <span
              class="dialkit-folder-title dial-spike-name"
            >{{@dial.name}}</span>
            <button
              type="button"
              class="dial-spike-btn"
              {{on "click" @dial.reset}}
            >reset</button>
            <button
              type="button"
              class="dial-spike-btn"
              {{on "click" this.copy}}
            >
              {{if this.copied "copied" "copy"}}
            </button>
          </header>

          {{#if this.characters.length}}
            <div class="dial-tunes">
              {{#each this.characters key="name" as |character|}}
                <button
                  type="button"
                  class="dial-tune"
                  title={{character.note}}
                  {{on "click" (fn this.wear character)}}
                >{{character.name}}</button>
              {{/each}}

              {{#each @dial.presets key="id" as |preset|}}
                {{! dialkit's markup, verbatim: the forget control rides inside
                    the preset chip, so the shared theme.css styles it }}
                <button
                  {{! template-lint-disable no-nested-interactive }}
                  type="button"
                  class={{this.presetClass preset}}
                  {{on "click" (fn this.load preset)}}
                >
                  {{preset.name}}
                  <span
                    class="dial-tune-x"
                    role="button"
                    tabindex="0"
                    {{on "click" (fn this.forget preset)}}
                  >×</span>
                </button>
              {{/each}}

              {{#if this.naming}}
                <form class="dial-tune-form" {{on "submit" this.commitName}}>
                  <input
                    class="dial-tune-input"
                    aria-label="Preset name"
                    placeholder="name it"
                    value={{this.draft}}
                    {{on "input" this.onDraft}}
                    {{on "blur" this.cancelNaming}}
                  />
                </form>
              {{else}}
                <button
                  type="button"
                  class="dial-tune is-save"
                  {{on "click" this.startNaming}}
                >save</button>
              {{/if}}
            </div>
          {{/if}}

          {{! `.dialkit-folder-inner` is dialkit's own control-row container: a
              flex column with a 6px gap. Using it rather than spacing the rows
              by hand is the same trade as the rest of this panel — the package
              decides what it looks like. }}
          <div class="dialkit-folder-inner">
            <DialNativeControls @dial={{@dial}} />
          </div>
        </div>
      </div>
    </div>
  </template>
}

export default DialPanel;
