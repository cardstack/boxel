import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { concat, fn } from '@ember/helper';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import type Owner from '@ember/owner';

import type { ColorFieldSignature } from '../util/color-field-signature';
import {
  parseCssColor,
  SliderColorFormat,
  SliderVariantConfiguration,
} from '../util/color-utils';
import {
  detectColorFormat,
  hslToRgb,
  rgbaToFormatString,
  rgbaToHsl,
  type HSL,
  type RGB,
  type RGBA,
} from '@cardstack/boxel-ui/helpers';

export default class SliderPicker extends Component<ColorFieldSignature> {
  @tracked isDragging = false;
  @tracked rgb: RGB = { r: 59, g: 130, b: 246 };
  @tracked hsl: HSL = { h: 0, s: 0, l: 0 };
  @tracked alpha = 1;

  private pendingRgba: RGBA | null = null;
  private lastSyncedModelColor: string | null = null;
  private lastSavedColorValue: string | null = null;
  private lastSavedHue: number | null = null;
  private lastSavedSaturation: number | null = null;
  private lastSavedLightness: number | null = null;

  constructor(owner: Owner, args: ColorFieldSignature['Args']) {
    super(owner, args);
    this.syncStateWithModel(this.currentColor);
  }

  get currentColor(): string {
    return this.args.model ?? '#3b82f6';
  }

  get availableFormats(): SliderColorFormat[] {
    return ['rgb', 'hsl'];
  }

  get defaultFormat(): SliderColorFormat {
    const options = (this.args.configuration as SliderVariantConfiguration)
      ?.options;
    return options?.defaultFormat ?? this.availableFormats[0];
  }

  get outputFormat(): SliderColorFormat {
    const options = (this.args.configuration as SliderVariantConfiguration)
      ?.options;

    if (options?.defaultFormat) {
      return options.defaultFormat;
    }

    if (this.args.model) {
      const format = detectColorFormat(this.args.model);
      if (format === 'rgb' || format === 'hsl') {
        return format as SliderColorFormat;
      }
    }

    return 'rgb';
  }

  get displayRgb(): RGB {
    this.ensureSyncedWithModel();
    return this.rgb;
  }

  get displayHsl(): HSL {
    this.ensureSyncedWithModel();
    return this.hsl;
  }

  private ensureSyncedWithModel(): void {
    if (this.isDragging) {
      return;
    }
    if (this.currentColor !== this.lastSyncedModelColor) {
      this.syncStateWithModel(this.currentColor);
    }
  }

  private syncStateWithModel(color: string): void {
    const parsed = parseCssColor(color);
    const normalizedRgb: RGB = {
      r: Math.round(parsed.r),
      g: Math.round(parsed.g),
      b: Math.round(parsed.b),
    };
    const parsedHsl = rgbaToHsl(parsed);
    const shouldPreserveHsl =
      this.lastSavedColorValue === color &&
      Number.isFinite(this.lastSavedHue ?? NaN) &&
      Number.isFinite(this.lastSavedSaturation ?? NaN) &&
      Number.isFinite(this.lastSavedLightness ?? NaN);
    this.rgb = normalizedRgb;
    this.hsl = shouldPreserveHsl
      ? {
          h: this.lastSavedHue as number,
          s: this.lastSavedSaturation as number,
          l: this.lastSavedLightness as number,
        }
      : parsedHsl;
    this.lastSavedHue = null;
    this.lastSavedSaturation = null;
    this.lastSavedLightness = null;
    this.lastSavedColorValue = null;
    this.alpha = parsed.a;
    this.pendingRgba = parsed;
    this.lastSyncedModelColor = color;
  }

  private buildRgbaFromRgb(rgb: RGB): RGBA {
    return { ...rgb, a: this.alpha };
  }

  private updateDraftState(rgb: RGB, hsl: HSL, rgba: RGBA): void {
    this.rgb = rgb;
    this.hsl = hsl;
    this.pendingRgba = rgba;
  }

  private formatColorForOutput(rgba: RGBA): string {
    if (this.outputFormat === 'hsl') {
      const roundedHue = Math.round(this.hsl.h);
      const roundedSaturation = Math.round(this.hsl.s);
      const roundedLightness = Math.round(this.hsl.l);
      if (this.alpha < 1) {
        return `hsla(${roundedHue}, ${roundedSaturation}%, ${roundedLightness}%, ${this.alpha.toFixed(
          2,
        )})`;
      }
      return `hsl(${roundedHue}, ${roundedSaturation}%, ${roundedLightness}%)`;
    }
    return rgbaToFormatString(rgba, this.outputFormat);
  }

  get rGradient(): string {
    const { g, b } = this.displayRgb;
    return `linear-gradient(to right, rgb(0, ${g}, ${b}), rgb(255, ${g}, ${b}))`;
  }

  get gGradient(): string {
    const { r, b } = this.displayRgb;
    return `linear-gradient(to right, rgb(${r}, 0, ${b}), rgb(${r}, 255, ${b}))`;
  }

  get bGradient(): string {
    const { r, g } = this.displayRgb;
    return `linear-gradient(to right, rgb(${r}, ${g}, 0), rgb(${r}, ${g}, 255))`;
  }

  get hGradient(): string {
    return 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  }

  get sGradient(): string {
    const { h, l } = this.displayHsl;
    const roundedHue = Math.round(h);
    const roundedLightness = Math.round(l);
    return `linear-gradient(to right, hsl(${roundedHue}, 0%, ${roundedLightness}%), hsl(${roundedHue}, 100%, ${roundedLightness}%))`;
  }

  get lGradient(): string {
    const { h, s } = this.displayHsl;
    const roundedHue = Math.round(h);
    const roundedSaturation = Math.round(s);
    return `linear-gradient(to right, hsl(${roundedHue}, ${roundedSaturation}%, 0%), hsl(${roundedHue}, ${roundedSaturation}%, 50%), hsl(${roundedHue}, ${roundedSaturation}%, 100%))`;
  }

  private isRgbaValid(rgba: RGBA): boolean {
    return (
      Number.isFinite(rgba.r) &&
      Number.isFinite(rgba.g) &&
      Number.isFinite(rgba.b) &&
      Number.isFinite(rgba.a)
    );
  }

  private saveColor(rgba: RGBA) {
    if (!this.isRgbaValid(rgba)) {
      return;
    }
    const colorValue = this.formatColorForOutput(rgba);
    this.lastSavedColorValue = colorValue;
    if (this.outputFormat === 'hsl') {
      this.lastSavedHue = this.hsl.h;
      this.lastSavedSaturation = this.hsl.s;
      this.lastSavedLightness = this.hsl.l;
    } else {
      this.lastSavedHue = null;
      this.lastSavedSaturation = null;
      this.lastSavedLightness = null;
    }
    this.args.set?.(colorValue);
  }

  @action
  handleRgbInput(channel: 'r' | 'g' | 'b', value: string | number) {
    if (!this.args.canEdit) return;

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;

    const clamped = Math.max(0, Math.min(255, numericValue));
    const newRgb: RGB = { ...this.rgb, [channel]: clamped };
    const newRgba = this.buildRgbaFromRgb(newRgb);
    const newHsl = rgbaToHsl(newRgba);
    this.updateDraftState(newRgb, newHsl, newRgba);
    this.isDragging = true;
  }

  @action
  handleHslInput(channel: 'h' | 's' | 'l', value: string | number) {
    if (!this.args.canEdit) return;

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;

    const limits = channel === 'h' ? [0, 360] : [0, 100];
    const clamped = Math.max(limits[0], Math.min(limits[1], numericValue));
    const newHsl = { ...this.hsl, [channel]: clamped } as HSL;
    const rgbFromHsl = hslToRgb(newHsl);
    const newRgba = this.buildRgbaFromRgb(rgbFromHsl);
    this.updateDraftState(rgbFromHsl, newHsl, newRgba);
    this.isDragging = true;
  }

  @action
  handleSliderChange() {
    if (!this.args.canEdit || !this.pendingRgba) return;

    this.saveColor(this.pendingRgba);
    this.isDragging = false;
  }

  <template>
    <div class='slider-controls-editor'>
      {{#if (eq this.outputFormat 'rgb')}}
        <div class='slider-group'>
          <div class='slider-header'>
            <label class='slider-label red'>
              <svg
                class='label-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
              </svg>
              Red
            </label>
            <span class='slider-value'>{{this.displayRgb.r}}</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='255'
              @value={{this.displayRgb.r}}
              class='range-slider'
              style={{htmlSafe (concat 'background: ' this.rGradient)}}
              @onInput={{fn this.handleRgbInput 'r'}}
              @onChange={{this.handleSliderChange}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>

        <div class='slider-group'>
          <div class='slider-header'>
            <label class='slider-label green'>
              <svg
                class='label-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
              </svg>
              Green
            </label>
            <span class='slider-value'>{{this.displayRgb.g}}</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='255'
              @value={{this.displayRgb.g}}
              class='range-slider'
              style={{htmlSafe (concat 'background: ' this.gGradient)}}
              @onInput={{fn this.handleRgbInput 'g'}}
              @onChange={{this.handleSliderChange}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>

        <div class='slider-group'>
          <div class='slider-header'>
            <label class='slider-label blue'>
              <svg
                class='label-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
              </svg>
              Blue
            </label>
            <span class='slider-value'>{{this.displayRgb.b}}</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='255'
              @value={{this.displayRgb.b}}
              class='range-slider'
              style={{htmlSafe (concat 'background: ' this.bGradient)}}
              @onInput={{fn this.handleRgbInput 'b'}}
              @onChange={{this.handleSliderChange}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>
      {{else if (eq this.outputFormat 'hsl')}}
        <div class='slider-group'>
          <div class='slider-header'>
            <label class='slider-label hue'>
              <svg
                class='label-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='M12 2v20' />
              </svg>
              Hue
            </label>
            <span class='slider-value'>{{Math.round this.displayHsl.h}}°</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='360'
              @value={{Math.round this.displayHsl.h}}
              class='range-slider'
              style={{htmlSafe (concat 'background: ' this.hGradient)}}
              @onInput={{fn this.handleHslInput 'h'}}
              @onChange={{this.handleSliderChange}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>

        <div class='slider-group'>
          <div class='slider-header'>
            <label class='slider-label saturation'>
              <svg
                class='label-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <circle cx='12' cy='12' r='6' />
              </svg>
              Saturation
            </label>
            <span class='slider-value'>{{Math.round this.displayHsl.s}}%</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='100'
              @value={{Math.round this.displayHsl.s}}
              class='range-slider'
              style={{htmlSafe (concat 'background: ' this.sGradient)}}
              @onInput={{fn this.handleHslInput 's'}}
              @onChange={{this.handleSliderChange}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>

        <div class='slider-group'>
          <div class='slider-header'>
            <label class='slider-label lightness'>
              <svg
                class='label-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='5' />
                <path
                  d='M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24'
                />
              </svg>
              Lightness
            </label>
            <span class='slider-value'>{{Math.round this.displayHsl.l}}%</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='100'
              @value={{Math.round this.displayHsl.l}}
              class='range-slider'
              style={{htmlSafe (concat 'background: ' this.lGradient)}}
              @onInput={{fn this.handleHslInput 'l'}}
              @onChange={{this.handleSliderChange}}
              @disabled={{not @canEdit}}
            />
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .slider-controls-editor {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        padding: 0.5rem;
        border-radius: var(--radius, 0.5rem);
        transition: background 0.2s;
        background: var(--boxel-light, #ffffff);
      }

      .slider-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .slider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .slider-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--foreground, #0f172a);
      }

      .label-icon {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
        color: var(--muted-foreground, #64748b);
      }

      .slider-value {
        font-family: var(
          --font-mono,
          'SF Mono',
          'Monaco',
          'Courier New',
          monospace
        );
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        min-width: 3rem;
        text-align: right;
      }

      .range-slider-container {
        width: 100%;
      }

      .range-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        --boxel-input-height: 0.5rem;
        border-radius: calc(var(--radius, 0.5rem));
        border: 1px solid var(--border, #e2e8f0);
        outline: none;
        cursor: pointer;
        display: block;
        padding: 0;
      }

      .range-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 1rem;
        height: 1rem;
        background: var(--background, #ffffff);
        border: 2px solid var(--foreground, #000000);
        border-radius: 50%;
        cursor: pointer;
        box-shadow:
          0 0 0 1.5px var(--background, #ffffff),
          0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .range-slider::-moz-range-thumb {
        width: 1rem;
        height: 1rem;
        background: var(--background, #ffffff);
        border: 2px solid var(--foreground, #000000);
        border-radius: 50%;
        cursor: pointer;
        box-shadow:
          0 0 0 1.5px var(--background, #ffffff),
          0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .range-slider:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .range-slider:disabled::-webkit-slider-thumb {
        cursor: not-allowed;
      }

      .range-slider:disabled::-moz-range-thumb {
        cursor: not-allowed;
      }
    </style>
  </template>
}
