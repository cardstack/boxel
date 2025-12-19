import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { concat, fn } from '@ember/helper';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';

import type {
  RGBA,
  SliderColorFormat,
  SliderVariantConfiguration,
} from '../util/color-utils';
import {
  detectColorFormat,
  parseCssColor,
  rgbaToFormat,
  rgbaToHslValues,
  hslToRgb,
} from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';

export default class SliderEdit extends Component<ColorFieldSignature> {
  // ========== Properties ==========
  @tracked isDragging = false;
  @tracked draftColor: string | null = null;

  // Cache for parsed values to avoid recomputation
  private cachedRgba: RGBA | null = null;
  private cachedRgb: { r: number; g: number; b: number } | null = null;
  private cachedHsl: { h: number; s: number; l: number } | null = null;
  private lastComputedColor: string | null = null;

  // ========== Getters ==========
  get currentColor(): string {
    return this.isDragging && this.draftColor
      ? this.draftColor
      : this.args.model || '#3b82f6';
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

  get parsedRgba(): RGBA {
    const color = this.currentColor;
    // Cache to avoid recomputation on every access
    if (this.lastComputedColor === color && this.cachedRgba) {
      return this.cachedRgba;
    }
    this.lastComputedColor = color;
    this.cachedRgba = parseCssColor(color);
    // Invalidate other caches
    this.cachedRgb = null;
    this.cachedHsl = null;
    return this.cachedRgba;
  }

  get rgb() {
    if (this.cachedRgb) {
      return this.cachedRgb;
    }
    const { r, g, b } = this.parsedRgba;
    this.cachedRgb = { r, g, b };
    return this.cachedRgb;
  }

  get hsl() {
    if (this.cachedHsl) {
      return this.cachedHsl;
    }
    this.cachedHsl = rgbaToHslValues(this.parsedRgba);
    return this.cachedHsl;
  }

  // ========== Gradient Getters ==========
  get rGradient(): string {
    const { g, b } = this.rgb;
    return `linear-gradient(to right, rgb(0, ${g}, ${b}), rgb(255, ${g}, ${b}))`;
  }

  get gGradient(): string {
    const { r, b } = this.rgb;
    return `linear-gradient(to right, rgb(${r}, 0, ${b}), rgb(${r}, 255, ${b}))`;
  }

  get bGradient(): string {
    const { r, g } = this.rgb;
    return `linear-gradient(to right, rgb(${r}, ${g}, 0), rgb(${r}, ${g}, 255))`;
  }

  get hGradient(): string {
    return 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  }

  get sGradient(): string {
    const h = Math.round(this.hsl.h);
    const l = Math.round(this.hsl.l);
    return `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
  }

  get lGradient(): string {
    const h = Math.round(this.hsl.h);
    const s = Math.round(this.hsl.s);
    return `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
  }

  // ========== Private Helper Methods ==========
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
    const colorValue = rgbaToFormat(rgba, this.outputFormat);
    this.args.set?.(colorValue);
    // Clear cache when saving
    this.clearCache();
  }

  private clearCache() {
    this.cachedRgba = null;
    this.cachedRgb = null;
    this.cachedHsl = null;
    this.lastComputedColor = null;
  }

  private updateDraftColor(newRgba: RGBA) {
    // Only update draftColor if it actually changed to avoid unnecessary re-renders
    const newColor = rgbaToFormat(newRgba, this.outputFormat);
    if (this.draftColor !== newColor) {
      this.draftColor = newColor;
      // Clear cache when draft changes
      this.clearCache();
    }
  }

  // ========== Action Methods ==========
  @action
  handleRgbInput(channel: 'r' | 'g' | 'b', value: string | number) {
    if (!this.args.canEdit) return;

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;

    if (!this.isDragging) {
      this.isDragging = true;
    }

    const clamped = Math.max(0, Math.min(255, numericValue));
    const newRgba = { ...this.parsedRgba, [channel]: clamped };
    this.updateDraftColor(newRgba);
  }

  @action
  handleHslInput(channel: 'h' | 's' | 'l', value: string | number) {
    if (!this.args.canEdit) return;

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;

    if (!this.isDragging) {
      this.isDragging = true;
    }

    const limits = channel === 'h' ? [0, 360] : [0, 100];
    const clamped = Math.max(limits[0], Math.min(limits[1], numericValue));
    const newHsl = { ...this.hsl, [channel]: clamped };
    const rgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    const newRgba = { ...rgb, a: this.parsedRgba.a };
    this.updateDraftColor(newRgba);
  }

  @action
  handleSliderChange() {
    if (!this.args.canEdit || !this.isDragging) return;

    const colorSource = this.draftColor ?? this.currentColor;
    const rgba = parseCssColor(colorSource);
    this.saveColor(rgba);

    this.isDragging = false;
    this.draftColor = null;
    this.clearCache();
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
            <span class='slider-value'>{{this.rgb.r}}</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='255'
              @value={{this.rgb.r}}
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
            <span class='slider-value'>{{this.rgb.g}}</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='255'
              @value={{this.rgb.g}}
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
            <span class='slider-value'>{{this.rgb.b}}</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='255'
              @value={{this.rgb.b}}
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
            <span class='slider-value'>{{Math.round this.hsl.h}}°</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='360'
              @value={{Math.round this.hsl.h}}
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
            <span class='slider-value'>{{Math.round this.hsl.s}}%</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='100'
              @value={{Math.round this.hsl.s}}
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
            <span class='slider-value'>{{Math.round this.hsl.l}}%</span>
          </div>
          <div class='range-slider-container'>
            <BoxelInput
              @type='range'
              @min='0'
              @max='100'
              @value={{Math.round this.hsl.l}}
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
