// Pretui — ColorPicker: the full colour picker: area, channels, format and swatches.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Button } from './button';
import { Select } from './select';
import type { SelectOption } from './select';
import { ScrubInput } from './scrub-input';
import { BLACK, GAMUTS, SPACES, areaHeldChannel, channelDisplay, channelValueText, clampTo, cssFor, describeColor, gamutLabel, inGamutOf, parseColor, round, serializeColor, spaceSpec, toHex, toSpace, withAlpha, withChannel, withHeldChannel } from '../color-engine';
import type { ColorValue, GamutId, SpaceId } from '../color-engine';
import { ChannelSlider } from './channel-slider';
import type { ChannelTrack } from './channel-slider';
import { ColorArea } from './color-area';

// ── ColorPicker ──────────────────────────────────────────────────────────

const FALLBACK_SPACE: SpaceId = 'oklch';

export type ColorFormat = 'auto' | 'hex' | 'css';

export interface ColorPickerSignature {
  Args: {
    /** Controlled value, any CSS colour string. */
    value?: string;
    /** Uncontrolled starting value. */
    defaultValue?: string;
    /** Channel model shown. Uncontrolled when omitted. */
    space?: SpaceId;
    defaultSpace?: SpaceId;
    /** Gamut colours are checked and clamped against. Default sRGB. */
    gamut?: GamutId;
    /** Emitted string shape. `auto` gives hex for the RGB-ish models and
     *  the space's own CSS function otherwise. */
    format?: ColorFormat;
    /** Hide the alpha slider and drop alpha from the emitted value. */
    noAlpha?: boolean;
    /** Hide the space switcher, locking the model to `@space`. */
    lockSpace?: boolean;
    /** Hide the gamut switcher. The gamut READOUT always stays. */
    lockGamut?: boolean;
    /** Area paint resolution. */
    resolution?: number;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    onSpaceChange?: (space: SpaceId) => void;
  };
  Element: HTMLDivElement;
}

export class ColorPicker extends Component<ColorPickerSignature> {
  @tracked private internal: ColorValue | null = null;
  @tracked private emitted = '';
  @tracked private internalSpace: SpaceId | null = null;
  @tracked private internalGamut: GamutId | null = null;
  @tracked private textDraft: string | null = null;
  @tracked private textInvalid = false;
  @tracked announcement = '';

  // ── value ──
  //
  // **The working colour lives in the AREA MODEL space, not the display
  // space.** This is the single most consequential decision in the
  // component, and it exists because colour spaces have DEGENERATE points
  // that destroy user input on a round trip:
  //
  //   * every fully-desaturated colour has no hue,
  //   * every black has no saturation,
  //   * every achromatic OKLCH colour has no hue.
  //
  // If the picker stored sRGB and re-derived the area position each render,
  // then dragging to the bottom of an HSV plane (value 0 = black) would
  // convert to `#000000`, convert back to `hsv(0 0 0)`, and snap the cursor
  // to the left edge — silently discarding the hue and saturation the user
  // had chosen. Dragging back up would come out grey. Storing the model
  // coordinates makes the plane lossless: the sRGB value is DERIVED for
  // display and emission, never the other way round.
  //
  // The corollary is that `color` and `displayColor` are different colours
  // in different spaces and are not interchangeable at a call site — area
  // and the held slider take `color`; channel inputs, text and emission
  // take `displayColor`.
  get color(): ColorValue {
    return toSpace(this.sourceColor, this.modelSpace);
  }

  /** The same colour in the space whose channels are on screen. */
  get displayColor(): ColorValue {
    return toSpace(this.color, this.space);
  }

  /** The space the area's geometry (and therefore the stored value) lives
   *  in: `hsv` for the sRGB-ish models, `oklch` for OKLCH/P3/Rec.2020,
   *  `oklab` for OKLab. */
  get modelSpace(): SpaceId {
    return spaceSpec(this.space).area.model;
  }

  private get sourceColor(): ColorValue {
    let incoming = this.args.value;
    if (incoming !== undefined && incoming !== this.emitted) {
      // The caller pushed a value we did not emit — it wins.
      let parsed = parseColor(incoming);
      if (parsed) {
        return parsed;
      }
    }
    if (this.internal) {
      return this.internal;
    }
    return parseColor(incoming ?? this.args.defaultValue ?? '') ?? BLACK;
  }

  get space(): SpaceId {
    return (
      this.args.space ??
      this.internalSpace ??
      this.args.defaultSpace ??
      FALLBACK_SPACE
    );
  }
  get gamut(): GamutId {
    return this.args.gamut ?? this.internalGamut ?? 'srgb';
  }
  get spec() {
    return spaceSpec(this.space);
  }

  // ── gamut reporting ──
  get gamutResult() {
    return clampTo(this.color, this.gamut);
  }
  get outOfGamut(): boolean {
    return !inGamutOf(this.color, this.gamut);
  }
  get clampedHex(): string {
    return toHex(this.gamutResult.color);
  }
  /** Rounded to 3 decimals: ΔE OK under ~0.02 is invisible, so three
   *  decimals is the smallest number that still distinguishes "the same
   *  colour" from "a different one". */
  get clampDistance(): number {
    return round(this.gamutResult.distance, 3);
  }
  get gamutName(): string {
    return gamutLabel(this.gamut);
  }

  // ── display strings ──
  get hex(): string {
    return toHex(this.displayColor);
  }
  get cssString(): string {
    return serializeColor(this.displayColor);
  }
  get textValue(): string {
    if (this.textDraft !== null) {
      return this.textDraft;
    }
    return this.args.format === 'css' ? this.cssString : this.hex;
  }
  get previewStyle() {
    return cssStyleFrom([
      cssDeclaration('--pretui-picker-preview', cssFor(this.color)),
      cssDeclaration('--pretui-picker-clamped', cssFor(this.gamutResult.color)),
    ]);
  }
  get description(): string {
    return describeColor(this.displayColor, this.gamut);
  }

  // ── options ──
  get spaceOptions(): SelectOption[] {
    return SPACES.map((entry) => ({
      value: entry.id,
      label: entry.label,
    }));
  }
  get gamutOptions(): SelectOption[] {
    return GAMUTS.map((entry) => ({ value: entry.id, label: entry.label }));
  }
  get spaceNote(): string {
    return this.spec.note;
  }

  // ── channels ──
  get held() {
    let info = areaHeldChannel(this.color);
    return {
      ...info,
      valueText: channelValueText(
        spaceSpec(info.model),
        info.index,
        info.display,
      ),
      track: this.heldTrack,
    };
  }
  get heldTrack(): ChannelTrack {
    // `color` is already in the area model, so this is a no-op conversion —
    // kept explicit so the call reads correctly if the model ever differs.
    let info = areaHeldChannel(this.color);
    return {
      kind: 'channel',
      color: toSpace(this.color, info.model),
      index: info.index,
      gamut: this.gamut,
      steps: 32,
    };
  }
  get channels() {
    let shown = this.displayColor;
    return this.spec.channels.map((channel, index) => ({
      channel,
      index,
      display: channelDisplay(shown, index),
      valueText: channelValueText(this.spec, index, channelDisplay(shown, index)),
      track: {
        kind: 'channel' as const,
        color: shown,
        index,
        gamut: this.gamut,
        steps: 20,
      },
    }));
  }
  get alphaTrack(): ChannelTrack {
    return { kind: 'alpha', color: this.color, gamut: this.gamut };
  }
  get alphaPercent(): number {
    return round(this.color.alpha * 100, 1);
  }
  get alphaValueText(): string {
    return `Opacity ${round(this.color.alpha * 100, 0)}%`;
  }

  get supportsEyeDropper(): boolean {
    return typeof window !== 'undefined' && 'EyeDropper' in window;
  }

  // ── committing ──
  private commit(next: ColorValue, announce = false) {
    let value = this.args.noAlpha ? withAlpha(next, 1) : next;
    // Stored in the model space, always — whatever space the caller of
    // `commit` happened to be working in. See the note on `color`.
    this.internal = toSpace(value, this.modelSpace);
    this.textDraft = null;
    this.textInvalid = false;
    let text = this.format(toSpace(value, this.space));
    this.emitted = text;
    if (announce) {
      this.announcement = describeColor(toSpace(value, this.space), this.gamut);
    }
    this.args.onValueChange?.(text);
  }

  private format(value: ColorValue): string {
    let mode = this.args.format ?? 'auto';
    if (mode === 'hex') {
      return toHex(value);
    }
    if (mode === 'css') {
      return serializeColor(value);
    }
    // auto: hex is the friendlier currency for the sRGB-bounded models, and
    // is lossless for them; the perceptual and wide-gamut models must keep
    // their own syntax or the whole point of picking in them is lost.
    return value.space === 'srgb' || value.space === 'hsl' || value.space === 'hsv'
      ? toHex(value)
      : serializeColor(value);
  }

  announce = () => {
    this.announcement = describeColor(this.displayColor, this.gamut);
  };

  // ── handlers ──
  handleArea = (next: ColorValue) => {
    this.commit(next);
  };
  handleHeld = (display: number) => {
    this.commit(withHeldChannel(this.color, display));
  };
  handleChannel = (index: number, display: number) => {
    this.commit(withChannel(this.displayColor, index, display));
  };
  handleChannelNumber = (index: number, value: number | null) => {
    if (value === null) {
      return;
    }
    this.commit(withChannel(this.displayColor, index, value), true);
  };
  handleAlpha = (percent: number) => {
    this.commit(withAlpha(this.color, percent / 100));
  };
  handleSpace = (next: string) => {
    let space = SPACES.find((entry) => entry.id === next)?.id ?? FALLBACK_SPACE;
    if (this.args.space === undefined) {
      this.internalSpace = space;
    }
    // Switching space must never change the COLOUR, only the coordinates it
    // is expressed in. The stored value carries over untouched; only the
    // model it is stored in (and the channels shown) change.
    this.commit(toSpace(this.color, space), true);
    this.args.onSpaceChange?.(space);
  };
  handleGamut = (next: string) => {
    let gamut = GAMUTS.find((entry) => entry.id === next)?.id ?? 'srgb';
    if (this.args.gamut === undefined) {
      this.internalGamut = gamut;
    }
    this.announcement = describeColor(this.displayColor, gamut);
  };
  handleText = (event: Event) => {
    let input = event.target as HTMLInputElement;
    this.textDraft = input.value;
    // Validate as you type but do not COMMIT as you type: a half-typed
    // `#ff` is not an error yet, and flashing red on every keystroke is
    // noise. Upstream marks the field invalid on every unparseable
    // keystroke; this only reports on commit.
    this.textInvalid = false;
  };
  handleTextCommit = () => {
    let draft = this.textDraft;
    if (draft === null) {
      return;
    }
    let parsed = parseColor(draft);
    if (!parsed) {
      this.textInvalid = true;
      return;
    }
    this.commit(this.args.noAlpha ? withAlpha(parsed, 1) : parsed, true);
  };
  handleTextKey = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.handleTextCommit();
    }
    if (event.key === 'Escape') {
      this.textDraft = null;
      this.textInvalid = false;
    }
  };
  acceptClamp = () => {
    this.commit(this.gamutResult.color, true);
  };
  copy = () => {
    let text = this.textValue;
    // Feature-detected, never assumed: the clipboard API is absent in
    // insecure contexts and in the prerenderer.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        this.announcement = 'Copy failed';
      });
      this.announcement = `Copied ${text}`;
    }
  };
  pickWithEyeDropper = () => {
    if (!this.supportsEyeDropper) {
      return;
    }
    // `EyeDropper` is not in lib.dom for every TS version the realm may be
    // type-checked with, and it is feature-detected above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    let Dropper = (window as any).EyeDropper;
    new Dropper()
      .open()
      .then((result: { sRGBHex: string }) => {
        let parsed = parseColor(result.sRGBHex);
        if (parsed) {
          // Alpha is preserved: the eyedropper samples a composited pixel
          // and has no opacity to report, so replacing the user's alpha
          // with 1 would silently discard a choice they made.
          this.commit(toSpace(withAlpha(parsed, this.color.alpha), this.space), true);
        }
      })
      .catch(() => {
        // The user cancelled — not an error, and not worth announcing.
      });
  };

  <template>
    <div
      class='pretui-picker'
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-color-picker
      ...attributes
    >
      <ColorArea
        @color={{this.color}}
        @gamut={{this.gamut}}
        @resolution={{@resolution}}
        @disabled={{@disabled}}
        @onChange={{this.handleArea}}
        @onCommit={{this.announce}}
      />

      <div class='pretui-picker-sliders'>
        <ChannelSlider
          @label={{this.held.spec.label}}
          @valueText={{this.held.valueText}}
          @value={{this.held.display}}
          @min={{this.held.spec.min}}
          @max={{this.held.spec.max}}
          @step={{this.held.spec.step}}
          @wrap={{this.held.spec.isHue}}
          @track={{this.held.track}}
          @disabled={{@disabled}}
          @onInput={{this.handleHeld}}
          @onCommit={{this.announce}}
        />
        {{#unless @noAlpha}}
          <ChannelSlider
            @label='Opacity'
            @valueText={{this.alphaValueText}}
            @value={{this.alphaPercent}}
            @min={{0}}
            @max={{100}}
            @step={{1}}
            @checker={{true}}
            @track={{this.alphaTrack}}
            @disabled={{@disabled}}
            @onInput={{this.handleAlpha}}
            @onCommit={{this.announce}}
          />
        {{/unless}}
      </div>

      <div class='pretui-picker-readout' style={{this.previewStyle}}>
        <span class='pretui-picker-chip' aria-hidden='true'></span>
        <div class='pretui-picker-text'>
          <input
            type='text'
            class='pretui-picker-input'
            spellcheck='false'
            autocomplete='off'
            aria-label='Colour value'
            aria-invalid={{if this.textInvalid 'true' 'false'}}
            value={{this.textValue}}
            disabled={{@disabled}}
            {{on 'input' this.handleText}}
            {{on 'change' this.handleTextCommit}}
            {{on 'keydown' this.handleTextKey}}
          />
          {{#if this.textInvalid}}
            <span class='pretui-picker-error'>Not a colour</span>
          {{/if}}
        </div>
        <div class='pretui-picker-tools'>
          {{#if this.supportsEyeDropper}}
            <Button
              @appearance='plain'
              @size='s'
              @disabled={{@disabled}}
              aria-label='Pick a colour from the screen'
              title='Pick a colour from the screen'
              {{on 'click' this.pickWithEyeDropper}}
            >⊙</Button>
          {{/if}}
          <Button
            @appearance='plain'
            @size='s'
            @disabled={{@disabled}}
            aria-label='Copy colour value'
            title='Copy colour value'
            {{on 'click' this.copy}}
          >⧉</Button>
        </div>
      </div>

      {{#if this.outOfGamut}}
        <div class='pretui-picker-gamutwarn'>
          <span class='pretui-picker-gamutswatch' aria-hidden='true'></span>
          <span class='pretui-picker-gamuttext'>
            Outside
            {{this.gamutName}}. Nearest showable is
            <b>{{this.clampedHex}}</b>
            (ΔE
            {{this.clampDistance}}).
          </span>
          <Button
            @appearance='outlined'
            @size='xs'
            @disabled={{@disabled}}
            {{on 'click' this.acceptClamp}}
          >Clamp</Button>
        </div>
      {{/if}}

      <div class='pretui-picker-channels'>
        {{#each this.channels key='index' as |entry|}}
          <label class='pretui-picker-channel'>
            <span class='pretui-picker-chlabel'>{{entry.channel.label}}</span>
            <ScrubInput
              @value={{entry.display}}
              @min={{entry.channel.min}}
              @max={{entry.channel.max}}
              @step={{entry.channel.step}}
              @precision={{entry.channel.precision}}
              @disabled={{@disabled}}
              @onInput={{fn this.handleChannelNumber entry.index}}
            />
          </label>
        {{/each}}
      </div>

      <div class='pretui-picker-spaces'>
        {{#unless @lockSpace}}
          <label class='pretui-picker-spacefield'>
            <span class='pretui-picker-chlabel'>Space</span>
            <Select
              @options={{this.spaceOptions}}
              @value={{this.space}}
              @disabled={{@disabled}}
              @onValueChange={{this.handleSpace}}
            />
          </label>
        {{/unless}}
        {{#unless @lockGamut}}
          <label class='pretui-picker-spacefield'>
            <span class='pretui-picker-chlabel'>Gamut</span>
            <Select
              @options={{this.gamutOptions}}
              @value={{this.gamut}}
              @disabled={{@disabled}}
              @onValueChange={{this.handleGamut}}
            />
          </label>
        {{/unless}}
      </div>

      <p class='pretui-picker-note'>{{this.spaceNote}}</p>

      {{! the colour, as readable text — never colour alone }}
      <p class='pretui-picker-described'>{{this.description}}</p>

      {{! announced on COMMIT only; a live region that fires per drag frame
          is unusable, which is why nothing here announces on input }}
      <span
        class='pretui-sr'
        role='status'
        aria-live='polite'
      >{{this.announcement}}</span>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-picker {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 8px);
          width: 100%;
          max-width: var(--pretui-picker-width, 280px);
          container-type: inline-size;
          font-size: var(--text-ui, 12px);
          color: var(--foreground);
        }
        .pretui-picker[data-disabled='true'] {
          opacity: 0.6;
        }
        .pretui-picker-sliders {
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 8px);
        }
        .pretui-picker-readout {
          display: flex;
          align-items: center;
          gap: var(--space-2, 5px);
        }
        .pretui-picker-chip {
          width: 26px;
          height: 26px;
          flex: none;
          border-radius: calc(var(--radius) / 2.5);
          /* the colour is an image layer: a bare <color> is only valid last */
          background:
            linear-gradient(var(--pretui-picker-preview, transparent) 0 0),
            var(
              --pretui-checker,
              repeating-conic-gradient(
                color-mix(in oklch, var(--foreground) 11%, transparent) 0 25%,
                transparent 0 50%
              )
            );
          background-size: auto, 8px 8px;
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--foreground) 16%, transparent);
        }
        .pretui-picker-text {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pretui-picker-input {
          width: 100%;
          min-width: 0;
          height: var(--control-h, 28px);
          padding: 0 var(--space-3, 8px);
          border: 0;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--input);
          font: inherit;
          font-family: var(--font-mono);
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
          /* a hex string must not reflow the field while a slider is dragged */
          font-variant-numeric: tabular-nums;
        }
        .pretui-picker-input:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-picker-input[aria-invalid='true'] {
          box-shadow: 0 0 0 1px var(--destructive);
        }
        .pretui-picker-error {
          font-size: var(--text-ui-sm, 11px);
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-picker-tools {
          display: flex;
          gap: 2px;
          flex: none;
        }
        .pretui-picker-gamutwarn {
          display: flex;
          align-items: center;
          gap: var(--space-2, 5px);
          padding: var(--space-2, 5px) var(--space-3, 8px);
          border-radius: calc(var(--radius) / 1.6);
          /* Law 2: one hue in, the whole treatment derived from it */
          background: color-mix(
            in oklch,
            var(--warning, var(--boxel-warning)) 12%,
            var(--card)
          );
          color: color-mix(
            in oklch,
            var(--foreground) 22%,
            var(--warning, var(--boxel-warning))
          );
          font-size: var(--text-ui-sm, 11px);
          line-height: 1.35;
        }
        .pretui-picker-gamutswatch {
          width: 14px;
          height: 14px;
          flex: none;
          border-radius: 3px;
          background: var(--pretui-picker-clamped, transparent);
          box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
        }
        .pretui-picker-gamuttext {
          flex: 1 1 auto;
        }
        .pretui-picker-channels {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--space-2, 5px);
        }
        .pretui-picker-channel,
        .pretui-picker-spacefield {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .pretui-picker-chlabel {
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11px);
          letter-spacing: var(--track-eyebrow, 0.06em);
          text-transform: uppercase;
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-picker-spaces {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-2, 5px);
        }
        .pretui-picker-note,
        .pretui-picker-described {
          margin: 0;
          font-size: var(--text-ui-sm, 11px);
          color: var(--muted-foreground);
          line-height: 1.4;
        }
        .pretui-picker-described {
          font-family: var(--font-mono);
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
        /* unnamed container query only */
        @container (max-width: 230px) {
          .pretui-picker-channels,
          .pretui-picker-spaces {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      }
    </style>
  </template>
}
