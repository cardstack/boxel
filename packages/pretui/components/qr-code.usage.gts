// Pretui — QrCode usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { QrCode } from './qr-code';
import type { QrRenderInfo } from './qr-code';
import { Token } from './token';

// ── QrCode ───────────────────────────────────────────────────────────────
const ECLS: string[] = ['L', 'M', 'Q', 'H'];

const VALUE_DISPLAYS: string[] = ['auto', 'link', 'text', 'none'];

const SAMPLE_VALUES: string[] = [
  'https://boxel.ai/tickets/TESSAR-2026-0041',
  'TESSAR-2026-0041',
  'BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nEND:VCARD',
];

class QrCodeUsage extends Component {
  ecls = ECLS;
  displays = VALUE_DISPLAYS;
  samples = SAMPLE_VALUES;

  @tracked value = SAMPLE_VALUES[0]!;
  @tracked label = 'Check-in code';
  @tracked errorCorrection = 'M';
  @tracked margin = 4;
  @tracked size = 200;
  @tracked foreground = '#000000';
  @tracked background = '#ffffff';
  @tracked valueDisplay = 'auto';
  @tracked caption = '';
  @tracked overlay = false;
  @tracked info: QrRenderInfo | undefined;

  setValue = (v: string) => (this.value = v);
  setLabel = (v: string) => (this.label = v);
  setEcl = (v: string) => (this.errorCorrection = v);
  setMargin = (v: number | null) => (this.margin = v ?? 4);
  setSize = (v: number | null) => (this.size = v ?? 200);
  setForeground = (v: string) => (this.foreground = v);
  setBackground = (v: string) => (this.background = v);
  setValueDisplay = (v: string) => (this.valueDisplay = v);
  setCaption = (v: string) => (this.caption = v);
  setOverlay = (v: boolean) => (this.overlay = v);
  noteRender = (info: QrRenderInfo) => (this.info = info);

  get eclValue(): 'L' | 'M' | 'Q' | 'H' {
    return this.errorCorrection as 'L' | 'M' | 'Q' | 'H';
  }
  get displayValue(): 'auto' | 'link' | 'text' | 'none' {
    return this.valueDisplay as 'auto' | 'link' | 'text' | 'none';
  }
  get versionText(): string {
    return this.info?.version ? 'v' + this.info.version : '—';
  }
  get modulesText(): string {
    return this.info?.moduleCount ? this.info.moduleCount + '²' : '—';
  }
  get contrastText(): string {
    return this.info?.contrastRejected ? 'rejected' : 'accepted';
  }
  get usage(): string {
    return [
      '<QrCode',
      "  @value='" + this.value.split('\n')[0] + "'",
      "  @label='" + this.label + "'",
      "  @errorCorrection='" + this.errorCorrection + "'",
      '  @margin={{' + this.margin + '}}',
      '  @size={{' + this.size + '}}',
      "  @valueDisplay='" + this.valueDisplay + "'",
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='QrCode'
      @description="Encodes a value to a QR symbol as one <svg> with one <path>, from a vendored copy of the qrcode encoder core — the two implementations this replaces imported it from a public CDN at runtime, which broke offline and handed a third party a seat inside the realm. Two things here are deliberately NOT theme-obedient, and it is worth pushing the knobs until you see why. Drag the quiet zone down to zero: it clamps at 4, because the margin lives in the viewBox where CSS cannot reach it and a symbol without it does not scan. Then set a foreground and background that are close in luminance, or invert them, or type a var() token: the pair is refused, the symbol falls back to black-on-white, and the refusal is stated in the caption rather than shipped as an unscannable code. Everything AROUND the symbol is fully tokenised and re-tints with the season. And whatever you encode is always reachable as selectable text or a real link — a QR code that only exists as an image is unusable to anyone not holding a second device."
      @source={{this.usage}}
    >
      <:example>
        <QrCode
          @value={{this.value}}
          @label={{this.label}}
          @errorCorrection={{this.eclValue}}
          @margin={{this.margin}}
          @size={{this.size}}
          @foreground={{this.foreground}}
          @background={{this.background}}
          @valueDisplay={{this.displayValue}}
          @caption={{this.caption}}
          @overlay={{this.overlay}}
          @onRender={{this.noteRender}}
        >
          <:overlay><span class='qr-mark'>B</span></:overlay>
        </QrCode>
        <p class='cap-readout'>
          <span class='cap-readoutLabel'>@onRender</span>
          <Token @value={{this.versionText}} />
          <Token @value={{this.modulesText}} />
          <Token @value={{this.contrastText}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @options={{this.samples}}
          @description='The payload. A URL becomes a real link under the symbol; anything else becomes selectable monospace text.'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='QR code'
          @description='Accessible name for the symbol itself. The encoded value is exposed separately, so repeating it here is usually noise.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='errorCorrection'
          @value={{this.errorCorrection}}
          @options={{this.ecls}}
          @defaultValue='M'
          @description='ISO/IEC 18004 level: L/M/Q/H recover roughly 7/15/25/30 percent. Higher costs capacity — watch the version token climb. Forced to H whenever overlay is set.'
          @onInput={{this.setEcl}}
        />
        <Args.Number
          @name='margin'
          @value={{this.margin}}
          @min={{0}}
          @max={{20}}
          @defaultValue={{4}}
          @description='Quiet zone in modules. Clamped to [4, 16]: this widens the margin, it can never remove it.'
          @onInput={{this.setMargin}}
        />
        <Args.Number
          @name='size'
          @value={{this.size}}
          @min={{40}}
          @max={{1200}}
          @defaultValue={{180}}
          @description='Rendered edge length in px, clamped to [64, 1024]. The only inline style the component writes, and it is a clamped integer.'
          @onInput={{this.setSize}}
        />
        <Args.String
          @name='foreground'
          @value={{this.foreground}}
          @defaultValue='#000000'
          @description='Dark modules. Opaque hex only — try var(--foreground), rgb(0 0 0), or a light value, and watch it get refused.'
          @onInput={{this.setForeground}}
        />
        <Args.String
          @name='background'
          @value={{this.background}}
          @defaultValue='#ffffff'
          @description='Light modules. The pair must be dark-on-light at 3:1 or better or both are discarded.'
          @onInput={{this.setBackground}}
        />
        <Args.String
          @name='valueDisplay'
          @value={{this.valueDisplay}}
          @options={{this.displays}}
          @defaultValue='auto'
          @description="How the encoded value appears as text. 'none' hides it visually but keeps it in the accessibility tree — it is never removed outright."
          @onInput={{this.setValueDisplay}}
        />
        <Args.String
          @name='caption'
          @value={{this.caption}}
          @description='Caption text under the symbol. The caption block wins over it.'
          @onInput={{this.setCaption}}
        />
        <Args.Bool
          @name='overlay'
          @value={{this.overlay}}
          @defaultValue={{false}}
          @description='Declares that an overlay block is supplied. Named blocks are invisible to component JS, so this flag is what raises error correction to H and reserves the centre — and the block renders only when it is set, so forgetting it makes the mark visibly vanish instead of silently producing an unscannable code.'
          @onInput={{this.setOverlay}}
        />
        <Args.Object
          @name='onRender'
          @value={{this.info}}
          @description='Reports version, module count, quiet zone, level, the colours actually used, and whether a caller pair was refused. Fires once per meaningful change, from a modifier taking only primitives.'
        />
        <Args.Yield
          @name='caption'
          @description='Replaces @caption.'
        />
        <Args.Yield
          @name='overlay'
          @description='A mark centred over the symbol, capped at 20 percent of its edge. Requires @overlay.'
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .qr-mark {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 12px;
        line-height: 1;
        color: var(--boxel-dark);
      }
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

export const DEMOS_QR_CODE: Record<string, unknown> = {
  QrCode: QrCodeUsage,
};
