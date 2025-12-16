import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { concat, fn } from '@ember/helper';
import { gt, eq, not } from '@cardstack/boxel-ui/helpers';
import { BoxelSelect, BoxelInput } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';

import type { ColorFieldConfiguration, ColorFormat } from '../util/color-utils';
import {
  detectColorFormat,
  parseCssColor,
  rgbaToFormat,
  rgbaToHslValues,
  rgbaToHsvValues,
  hslToRgb,
  hsvToRgb,
  rgbToHex,
} from '../util/color-utils';
import type { ColorFieldSignature } from '../util/colorfieldsignature';

export default class SliderEdit extends Component<ColorFieldSignature> {
  @tracked selectedMode: ColorFormat = 'rgb';
  @tracked isDragging = false;
  @tracked draftColor: string | null = null;

  get currentColor() {
    return this.isDragging && this.draftColor
      ? this.draftColor
      : this.args.model || '#3b82f6';
  }

  get sliderMode(): 'rgb' | 'hsl' | 'hsb' | 'all' {
    const options = (this.args.configuration as ColorFieldConfiguration & {
      variant: 'slider';
    })?.options;
    return options?.sliderMode ?? 'rgb';
  }

  get availableModes(): ColorFormat[] {
    if (this.sliderMode === 'all') {
      return ['rgb', 'hsl', 'hsb'];
    }
    return [this.sliderMode as ColorFormat];
  }

  get defaultMode(): ColorFormat {
    return this.availableModes[0];
  }

  get modeOptions() {
    return this.availableModes.map((mode) => ({
      label: mode.toUpperCase(),
      value: mode,
    }));
  }

  get selectedModeOption() {
    return (
      this.modeOptions.find((opt) => opt.value === this.selectedMode) ||
      this.modeOptions[0]
    );
  }

  constructor(owner: Owner, args: any) {
    super(owner, args);
    const detectedMode =
      typeof this.args.model === 'string'
        ? detectColorFormat(this.args.model)
        : null;
    const defaultMode = this.availableModes.includes(this.defaultMode)
      ? this.defaultMode
      : this.availableModes[0];
    const initialMode =
      detectedMode && this.availableModes.includes(detectedMode)
        ? detectedMode
        : defaultMode;
    this.selectedMode = initialMode;
  }

  get rgb() {
    const rgba = parseCssColor(this.currentColor);
    return { r: rgba.r, g: rgba.g, b: rgba.b };
  }

  get hsl() {
    const rgba = parseCssColor(this.currentColor);
    return rgbaToHslValues(rgba);
  }

  get hsb() {
    const rgba = parseCssColor(this.currentColor);
    return rgbaToHsvValues(rgba);
  }

  get rgbString() {
    return `rgb(${this.rgb.r}, ${this.rgb.g}, ${this.rgb.b})`;
  }

  get hslString() {
    return `hsl(${Math.round(this.hsl.h)}, ${Math.round(
      this.hsl.s,
    )}%, ${Math.round(this.hsl.l)}%)`;
  }

  get hsbString() {
    return `hsb(${Math.round(this.hsb.h)}, ${Math.round(
      this.hsb.s,
    )}%, ${Math.round(this.hsb.v)}%)`;
  }

  get rGradient() {
    return `linear-gradient(to right, rgb(0, ${this.rgb.g}, ${this.rgb.b}), rgb(255, ${this.rgb.g}, ${this.rgb.b}))`;
  }

  get gGradient() {
    return `linear-gradient(to right, rgb(${this.rgb.r}, 0, ${this.rgb.b}), rgb(${this.rgb.r}, 255, ${this.rgb.b}))`;
  }

  get bGradient() {
    return `linear-gradient(to right, rgb(${this.rgb.r}, ${this.rgb.g}, 0), rgb(${this.rgb.r}, ${this.rgb.g}, 255))`;
  }

  get hGradient() {
    return 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
  }

  get sGradient() {
    const h = Math.round(this.hsl.h);
    const l = Math.round(this.hsl.l);
    return `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
  }

  get lGradient() {
    const h = Math.round(this.hsl.h);
    const s = Math.round(this.hsl.s);
    return `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
  }

  get hsbSGradient() {
    const h = Math.round(this.hsb.h);
    return `linear-gradient(to right, #ffffff, hsl(${h}, 100%, 50%))`;
  }

  get vGradient() {
    const h = Math.round(this.hsb.h);
    const s = Math.round(this.hsb.s);
    return `linear-gradient(to right, #000000, hsl(${h}, ${s}%, 50%))`;
  }

  @action
  handleModeSelect(option: { label: string; value: ColorFormat } | null) {
    if (!option) return;
    this.selectedMode = option.value;
  }

  @action
  handleRgbInput(channel: 'r' | 'g' | 'b', value: string | number) {
    if (!this.args.canEdit) return;
    this.isDragging = true;
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;
    const newRgb = { ...this.rgb, [channel]: numericValue };
    this.draftColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
  }

  @action
  handleHslInput(channel: 'h' | 's' | 'l', value: string | number) {
    if (!this.args.canEdit) return;
    this.isDragging = true;
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;
    const newHsl = { ...this.hsl, [channel]: numericValue };
    const rgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
    this.draftColor = rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  @action
  handleHsbInput(channel: 'h' | 's' | 'v', value: string | number) {
    if (!this.args.canEdit) return;
    this.isDragging = true;
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;
    const newHsb = { ...this.hsb, [channel]: numericValue };
    const rgb = hsvToRgb(newHsb.h, newHsb.s, newHsb.v);
    this.draftColor = rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  @action
  handleSliderChange() {
    if (!this.args.canEdit || !this.isDragging) return;
    const colorSource = this.draftColor ?? this.currentColor;
    const rgba = parseCssColor(colorSource);
    const colorValue = rgbaToFormat(rgba, this.selectedMode);
    this.args.set?.(colorValue);
    this.isDragging = false;
    this.draftColor = null;
  }

  <template>
    <div class='slider-variant'>
      {{#if (gt this.availableModes.length 1)}}
        <div class='mode-selector'>
          <label class='mode-label'>Color Mode</label>
          <BoxelSelect
            @placeholder='Mode'
            @options={{this.modeOptions}}
            @selected={{this.selectedModeOption}}
            @onChange={{this.handleModeSelect}}
            class='mode-select'
            as |option|
          >
            {{option.label}}
          </BoxelSelect>
        </div>
      {{/if}}

      <div class='slider-controls'>
        {{#if (eq this.selectedMode 'rgb')}}
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
        {{else if (eq this.selectedMode 'hsl')}}
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
        {{else if (eq this.selectedMode 'hsb')}}
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
              <span class='slider-value'>{{Math.round this.hsb.h}}°</span>
            </div>
            <div class='range-slider-container'>
              <BoxelInput
                @type='range'
                @min='0'
                @max='360'
                @value={{Math.round this.hsb.h}}
                class='range-slider'
                style={{htmlSafe (concat 'background: ' this.hGradient)}}
                @onInput={{fn this.handleHsbInput 'h'}}
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
              <span class='slider-value'>{{Math.round this.hsb.s}}%</span>
            </div>
            <div class='range-slider-container'>
              <BoxelInput
                @type='range'
                @min='0'
                @max='100'
                @value={{Math.round this.hsb.s}}
                class='range-slider'
                style={{htmlSafe (concat 'background: ' this.hsbSGradient)}}
                @onInput={{fn this.handleHsbInput 's'}}
                @onChange={{this.handleSliderChange}}
                @disabled={{not @canEdit}}
              />
            </div>
          </div>

          <div class='slider-group'>
            <div class='slider-header'>
              <label class='slider-label brightness'>
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
                Brightness
              </label>
              <span class='slider-value'>{{Math.round this.hsb.v}}%</span>
            </div>
            <div class='range-slider-container'>
              <BoxelInput
                @type='range'
                @min='0'
                @max='100'
                @value={{Math.round this.hsb.v}}
                class='range-slider'
                style={{htmlSafe (concat 'background: ' this.vGradient)}}
                @onInput={{fn this.handleHsbInput 'v'}}
                @onChange={{this.handleSliderChange}}
                @disabled={{not @canEdit}}
              />
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* Slider Variant Container - Compact and clean */
      .slider-variant {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background: var(--background, #ffffff);
        border-radius: calc(var(--radius, 0.5rem) * 1.5);
        border: 1px solid var(--border, #e5e7eb);
      }

      /* Mode Selector - Compact */
      .mode-selector {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.5rem 0.75rem;
        background: var(--muted, #f9fafb);
        border-radius: calc(var(--radius, 0.5rem));
        border: 1px solid var(--border, #e5e7eb);
      }

      .mode-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .mode-select {
        flex: 1;
        min-width: 12rem;
      }

      /* Slider Controls Container - Tight spacing */
      .slider-controls {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        padding: 0.75rem;
        background: var(--muted, #f9fafb);
        border-radius: calc(var(--radius, 0.5rem));
        border: 1px solid var(--border, #e5e7eb);
      }

      /* Individual Slider Group - Minimal gap */
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

      /* Value Display Badge - Compact */
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

      /* Prevent layout shift when dropdown opens */
      :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }

      /* Range Slider Container - Remove positioning constraints */
      .range-slider-container {
        width: 100%;
      }

      /* Range Input Styling - Full control */
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

      /* Range Thumb Styling - WebKit (Chrome, Safari, Edge) */
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

      /* Range Thumb Styling - Firefox */
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

      /* Disabled state */
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
