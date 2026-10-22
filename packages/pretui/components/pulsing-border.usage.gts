// Pretui — PulsingBorder usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PulsingBorder } from './pulsing-border';
import type { PulsingBorderMarker, PulsingBorderVariant } from './pulsing-border';
import { Token } from './token';
import { HUE_OPTIONS, hueArg } from '../demo-texture';

// ── PulsingBorder ────────────────────────────────────────────────────────
const PB_VARIANTS: PulsingBorderVariant[] = ['pulse', 'trail'];

const PB_MARKERS: PulsingBorderMarker[] = [
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-end',
];

class PulsingBorderUsage extends Component {
  @tracked label = 'Live';
  @tracked active = true;
  @tracked variant: PulsingBorderVariant = 'pulse';
  @tracked hue = 'default';
  @tracked speed = 1;
  @tracked thickness = 1.5;
  @tracked marker = true;
  @tracked markerPlacement: PulsingBorderMarker = 'top-start';
  @tracked useLabelBlock = false;

  setLabel = (v: string) => (this.label = v);
  setActive = (v: boolean) => (this.active = v);
  setVariant = (v: string) => (this.variant = v as PulsingBorderVariant);
  setHue = (v: string) => (this.hue = v);
  setSpeed = (v: number | null) => (this.speed = v ?? 1);
  setThickness = (v: number | null) => (this.thickness = v ?? 1.5);
  setMarker = (v: boolean) => (this.marker = v);
  setMarkerPlacement = (v: string) =>
    (this.markerPlacement = v as PulsingBorderMarker);
  setUseLabelBlock = (v: boolean) => (this.useLabelBlock = v);

  get variantOptions() {
    return PB_VARIANTS;
  }
  get markerOptions() {
    return PB_MARKERS;
  }
  get hueOptions() {
    return HUE_OPTIONS;
  }
  get hueValue() {
    return hueArg(this.hue);
  }
  get usage() {
    let bits = [`@label='${this.label}'`];
    if (!this.active) bits.push('@active={{false}}');
    if (this.variant !== 'pulse') bits.push(`@variant='${this.variant}'`);
    if (this.hueValue) bits.push(`@hue='${this.hueValue}'`);
    if (this.speed !== 1) bits.push(`@speed={{${this.speed}}}`);
    if (this.thickness !== 1.5) bits.push(`@thickness={{${this.thickness}}}`);
    if (!this.marker) bits.push('@marker={{false}}');
    if (this.markerPlacement !== 'top-start') {
      bits.push(`@markerPlacement='${this.markerPlacement}'`);
    }
    let body = this.useLabelBlock
      ? `  <:label>{{this.sessionState}}</:label>\n  <:default>\n    <CuppingSheet />\n  </:default>`
      : `  <CuppingSheet />`;
    return `<PulsingBorder ${bits.join(' ')}>\n${body}\n</PulsingBorder>`;
  }
  <template>
    <FreestyleUsage
      @name='PulsingBorder'
      @description="The “this is live” boundary — and the canonical Law 6 borderline case. A pulsing ring on its own is information carried entirely by texture: invisible to a screen reader, unindexable, and absent from a still frame. So the text affordance is not optional here. The component always renders a role='status' marker (an ink Chip, reused rather than redrawn) on the boundary; @marker={{false}} demotes it to sr-only text but never removes it. Reach for it around anything genuinely streaming: an agent turn in flight, a recording, a price feed, a running import. Better than react-bits’ ElectricBorder / StarBorder and motion-primitives’ BorderTrail: the ring is an inset box-shadow rather than a border, so switching it on can never reflow the content it wraps; the halo animates transform and opacity only; the hue defaults to statusHue(label), so “Live” is the same hue on every card by every author; and their canvas/WebGL electric distortion is dropped outright (Law 9). The resting state is a visible hairline plus a soft glow, so it survives the screenshot test and reduced motion identically."
      @source={{this.usage}}
    >
      <:example>
        <div class='pb-wrap'>
          {{#if this.useLabelBlock}}
            <PulsingBorder
              class='pb-box'
              @active={{this.active}}
              @variant={{this.variant}}
              @hue={{this.hueValue}}
              @speed={{this.speed}}
              @thickness={{this.thickness}}
              @marker={{this.marker}}
              @markerPlacement={{this.markerPlacement}}
            >
              <:label>Cupping · table 3</:label>
              <:default>
                <div class='pb-body'>
                  <h3 class='pb-title'>Alishan Cloud Farms · lot 214</h3>
                  <p class='pb-line'>Ryo Katagiri is scoring aroma, liquor and
                    finish. Scores stream in as each bowl is called.</p>
                  <p class='pb-meta'>Milk Oolong · 11.2 kg ·
                    <Token @value='CUP-214' /></p>
                </div>
              </:default>
            </PulsingBorder>
          {{else}}
            <PulsingBorder
              class='pb-box'
              @label={{this.label}}
              @active={{this.active}}
              @variant={{this.variant}}
              @hue={{this.hueValue}}
              @speed={{this.speed}}
              @thickness={{this.thickness}}
              @marker={{this.marker}}
              @markerPlacement={{this.markerPlacement}}
            >
              <div class='pb-body'>
                <h3 class='pb-title'>Alishan Cloud Farms · lot 214</h3>
                <p class='pb-line'>Ryo Katagiri is scoring aroma, liquor and
                  finish. Scores stream in as each bowl is called.</p>
                <p class='pb-meta'>Milk Oolong · 11.2 kg ·
                  <Token @value='CUP-214' /></p>
              </div>
            </PulsingBorder>
          {{/if}}

          <p class='pb-note'>{{if
              this.marker
              'The marker is the affordance — turn it off below and the same words stay in the accessibility tree as sr-only text.'
              'Marker is sr-only: the ring still pulses, but the words are only in the accessibility tree. Use this ONLY when the surrounding UI already says “live”.'
            }}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @onInput={{this.setLabel}}
          @defaultValue='Live'
          @description='The text affordance — what the pulse MEANS (“Live”, “Streaming”, “Recording”, “Cupping”). Also seeds the default hue through statusHue, so changing the word changes the color deterministically. Never hidden: it renders visibly, or sr-only when @marker is false.'
        />
        <Args.Bool
          @name='active'
          @value={{this.active}}
          @onInput={{this.setActive}}
          @defaultValue={{true}}
          @description='Is it actually live? False rests the ring on the neutral border color, greys the chip and stops all motion. Change the label with it — an inactive ring saying “Live” is a lie the texture cannot correct.'
        />
        <Args.String
          @name='variant'
          @options={{this.variantOptions}}
          @value={{this.variant}}
          @onInput={{this.setVariant}}
          @defaultValue='pulse'
          @description='pulse = a breathing halo outside the ring; trail = a light travelling around the ring, drawn as a conic gradient masked to the border band via a registered @property angle.'
        />
        <Args.String
          @name='hue'
          @options={{this.hueOptions}}
          @value={{this.hue}}
          @onInput={{this.setHue}}
          @defaultValue='statusHue(label)'
          @description='Ring hue. Leave it at “default” and Law 2 does the work: the hue is a stable hash of the label, so the same word gets the same hue on every card. Override only when the surrounding design demands it.'
        />
        <Args.Number
          @name='speed'
          @min={{0.25}}
          @max={{4}}
          @step={{0.25}}
          @value={{this.speed}}
          @onInput={{this.setSpeed}}
          @defaultValue={{1}}
          @description='Motion rate multiplier (clamped 0.05–6). The pulse breathes at 2.6s and the trail sweeps at 4.5s; both divide by this.'
        />
        <Args.Number
          @name='thickness'
          @min={{0.5}}
          @max={{8}}
          @step={{0.5}}
          @value={{this.thickness}}
          @onInput={{this.setThickness}}
          @defaultValue={{1.5}}
          @description='Ring thickness in px (clamped 0.5–8). It is an inset box-shadow, not a border, so changing it never moves the content inside.'
        />
        <Args.Bool
          @name='marker'
          @value={{this.marker}}
          @onInput={{this.setMarker}}
          @defaultValue={{true}}
          @description='Render the affordance visibly on the boundary. False keeps it sr-only — for when the surrounding UI already carries the words. It never disappears entirely (Law 6).'
        />
        <Args.String
          @name='markerPlacement'
          @options={{this.markerOptions}}
          @value={{this.markerPlacement}}
          @onInput={{this.setMarkerPlacement}}
          @defaultValue='top-start'
          @description='Which corner of the boundary the affordance straddles. It sits half outside the ring, so leave that corner of your content clear.'
        />
        <Args.Bool
          @name='(demo) use the :label block'
          @value={{this.useLabelBlock}}
          @onInput={{this.setUseLabelBlock}}
          @defaultValue={{false}}
          @description='Demo-only switch — not a component arg. Renders the :label named block instead of @label, to show the slot escape hatch.'
        />
        <Args.Yield
          @description='Two blocks. :default is the bounded content, rendered above the ring and below the marker. :label replaces the affordance text with your own markup (Law 7 — anything visual a caller might replace is a slot, not a string); it still lands inside the role=status Chip, so it must remain readable text, not decoration.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pb-wrap {
        display: grid;
        gap: var(--space-4, 11px);
        padding-top: var(--space-3, 8px);
      }
      .pb-box {
        background: var(--card);
      }
      .pb-body {
        display: grid;
        gap: var(--space-2, 6px);
        padding: var(--space-6, 19px);
      }
      .pb-title {
        margin: 0;
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
      .pb-line {
        margin: 0;
        max-width: 52ch;
        font-size: var(--text-ui-md, 12.5px);
        line-height: 1.5;
        color: var(--muted-foreground);
      }
      .pb-meta {
        margin: 0;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .pb-note {
        margin: 0;
        max-width: 68ch;
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_PULSING_BORDER: Record<string, unknown> = {
  PulsingBorder: PulsingBorderUsage,
};
