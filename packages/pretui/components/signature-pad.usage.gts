// Pretui — SignaturePad usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { SignaturePad } from './signature-pad';
import type { SignatureValue } from './signature-pad';
import { Token } from './token';

const MODES: string[] = ['draw', 'type'];

// ── SignaturePad ─────────────────────────────────────────────────────────

class SignaturePadUsage extends Component {
  modes = MODES;

  @tracked label = 'Contractor signature';
  @tracked description =
    'Sign with a pointer, or switch to Type and enter your full name.';
  @tracked signerName = '';
  @tracked defaultMode = 'draw';
  @tracked hideTypedAlternative = false;
  @tracked penColor = '';
  @tracked minWidth = 0.7;
  @tracked maxWidth = 2.4;
  @tracked dotSize = 1.6;
  @tracked height = 180;
  @tracked required = false;
  @tracked last: SignatureValue | undefined;

  setLabel = (v: string) => (this.label = v);
  setDescription = (v: string) => (this.description = v);
  setSignerName = (v: string) => (this.signerName = v);
  setDefaultMode = (v: string) => (this.defaultMode = v);
  setHideTyped = (v: boolean) => (this.hideTypedAlternative = v);
  setPenColor = (v: string) => (this.penColor = v);
  setMinWidth = (v: number | null) => (this.minWidth = v ?? 0.7);
  setMaxWidth = (v: number | null) => (this.maxWidth = v ?? 2.4);
  setDotSize = (v: number | null) => (this.dotSize = v ?? 1.6);
  setHeight = (v: number | null) => (this.height = v ?? 180);
  setRequired = (v: boolean) => (this.required = v);
  noteChange = (value: SignatureValue) => (this.last = value);

  get defaultModeValue(): 'draw' | 'type' {
    return this.defaultMode === 'type' ? 'type' : 'draw';
  }
  get penColorValue(): string | undefined {
    return this.penColor.trim() === '' ? undefined : this.penColor;
  }
  get signerNameValue(): string | undefined {
    return this.signerName.trim() === '' ? undefined : this.signerName;
  }
  get modeText(): string {
    return this.last?.mode ?? '—';
  }
  get emptyText(): string {
    return this.last ? String(this.last.isEmpty) : '—';
  }
  get strokeText(): string {
    return this.last ? this.last.strokes.length + ' strokes' : '—';
  }
  get usage(): string {
    return [
      '<SignaturePad',
      "  @label='" + this.label + "'",
      "  @defaultMode='" + this.defaultMode + "'",
      '  @height={{' + this.height + '}}',
      '  @onChange={{this.persist}}',
      '  as |sig|',
      '>',
      '  <button type="button" disabled={{sig.isEmpty}}>Save</button>',
      '</SignaturePad>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='SignaturePad'
      @description="Variable-width Bézier capture over pointer events, on a vendored signature_pad. Four things here are the reason most signature pads are bad. The backing store is scaled by devicePixelRatio, so strokes are not soft on a retina screen. A resize replays the stroke data instead of losing it — drag the height knob mid-signature and watch it survive the wipe that changing canvas.width always causes. The engine runs with throttle 0, which means it schedules no timer at all, so nothing here can outlive the element or hang a test run. And the typed-name alternative is a full peer of drawing, not a courtesy: same onChange payload, same isEmpty semantics, same SVG and PNG output, reachable by Tab alone — because a pointer-only input is not an input for everyone. @onChange emits the STROKE DATA, never a picture; the block yields toSVG() and toPNG() for when you actually want one, SVG first."
      @source={{this.usage}}
    >
      <:example>
        <SignaturePad
          @label={{this.label}}
          @description={{this.description}}
          @signerName={{this.signerNameValue}}
          @defaultMode={{this.defaultModeValue}}
          @hideTypedAlternative={{this.hideTypedAlternative}}
          @penColor={{this.penColorValue}}
          @minWidth={{this.minWidth}}
          @maxWidth={{this.maxWidth}}
          @dotSize={{this.dotSize}}
          @height={{this.height}}
          @required={{this.required}}
          @onChange={{this.noteChange}}
        >
          <p class='cap-readout'>
            <span class='cap-readoutLabel'>@onChange</span>
            <Token @value={{this.modeText}} />
            <Token @value={{this.emptyText}} />
            <Token @value={{this.strokeText}} />
          </p>
        </SignaturePad>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Signature'
          @description='The visible label, and the stem of the canvas accessible name.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='description'
          @value={{this.description}}
          @description='Helper text under the surface, wired through aria-describedby to whichever input is active.'
          @onInput={{this.setDescription}}
        />
        <Args.String
          @name='signerName'
          @value={{this.signerName}}
          @description='Who is signing. Used in the exported image alt text, and as the initial typed name.'
          @onInput={{this.setSignerName}}
        />
        <Args.String
          @name='defaultMode'
          @value={{this.defaultMode}}
          @options={{this.modes}}
          @defaultValue='draw'
          @description='Which signing method is offered first.'
          @onInput={{this.setDefaultMode}}
        />
        <Args.Bool
          @name='hideTypedAlternative'
          @value={{this.hideTypedAlternative}}
          @defaultValue={{false}}
          @description='Strongly discouraged — it removes the only path for anyone who cannot draw with a pointer. It exists so a caller with a genuinely different fallback has to say so out loud.'
          @onInput={{this.setHideTyped}}
        />
        <Args.String
          @name='penColor'
          @value={{this.penColor}}
          @description='Ink colour. Opaque hex or rgb() only; anything else falls back to the ink resolved from the theme token, which is also what happens when this is left empty.'
          @onInput={{this.setPenColor}}
        />
        <Args.Number
          @name='minWidth'
          @value={{this.minWidth}}
          @min={{0.1}}
          @max={{10}}
          @step={{0.1}}
          @defaultValue={{0.7}}
          @description='Thinnest stroke in px — the fast end of the velocity taper.'
          @onInput={{this.setMinWidth}}
        />
        <Args.Number
          @name='maxWidth'
          @value={{this.maxWidth}}
          @min={{0.5}}
          @max={{30}}
          @step={{0.1}}
          @defaultValue={{2.4}}
          @description='Thickest stroke in px — the slow end. Widen the gap for a more calligraphic line.'
          @onInput={{this.setMaxWidth}}
        />
        <Args.Number
          @name='dotSize'
          @value={{this.dotSize}}
          @min={{0}}
          @max={{20}}
          @step={{0.1}}
          @defaultValue={{1.6}}
          @description='Radius of a single tap dot, so a full stop is not invisible.'
          @onInput={{this.setDotSize}}
        />
        <Args.Number
          @name='height'
          @value={{this.height}}
          @min={{60}}
          @max={{700}}
          @defaultValue={{180}}
          @description='Surface height in px, clamped to [80, 600]. Change it mid-signature: the strokes are replayed onto the new backing store rather than wiped.'
          @onInput={{this.setHeight}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @defaultValue={{false}}
          @description='Marks the control required, with a visually-hidden "(required)" inside the label so it reaches AT.'
          @onInput={{this.setRequired}}
        />
        <Args.Object
          @name='onChange'
          @value={{this.last}}
          @description='Receives { mode, strokes, typedName, isEmpty } on every stroke, clear, typed keystroke and method change. Stroke data, not an image — the caller decides what to persist.'
        />
        <Args.Yield
          @name='default'
          @description='Receives the handle: mode, isEmpty, value, clear(), toSVG(), toPNG(), altText.'
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .cap-readout {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .cap-readoutLabel {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_SIGNATURE_PAD: Record<string, unknown> = {
  SignaturePad: SignaturePadUsage,
};
