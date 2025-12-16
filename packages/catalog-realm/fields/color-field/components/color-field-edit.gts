import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { eq, or, not } from '@cardstack/boxel-ui/helpers';
import { ColorPicker } from '@cardstack/boxel-ui/components';

import type {
  ColorFieldConfiguration,
  ColorVariant,
} from '../util/color-utils';
import { parseCssColorSafe, rgbaToHex } from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';
import AdvancedEdit from './advanced-edit';
import SwatchesPickerEdit from './swatches-picker-edit';
import SliderEdit from './slider-edit';
import ColorWheelEdit from './color-wheel-edit';
import RecentColorsAddon from './recent-colors-addon';
import ContrastCheckerAddon from './contrast-checker-addon';

export default class ColorFieldEdit extends Component<ColorFieldSignature> {
  @tracked recentColors: string[] = [];
  @tracked localColor: string | null = null; // Local state for smooth color pick / color drag

  // Like React's useRef - not tracked, maintains value across renders
  private previousColorRef: string | null = null;
  private recentColorTimeout: ReturnType<typeof setTimeout> | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.previousColorRef = this.normalizeColor(this.args.model);
    this.localColor = this.args.model;
  }

  willDestroy() {
    super.willDestroy();
    // Clean up pending timeouts to prevent memory leak
    if (this.recentColorTimeout) {
      clearTimeout(this.recentColorTimeout);
      this.recentColorTimeout = null;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  }

  get variant(): ColorVariant {
    return (
      (this.args.configuration as ColorFieldConfiguration)?.variant ??
      'standard'
    );
  }

  get showRecent(): boolean {
    return (
      (this.args.configuration as ColorFieldConfiguration)?.options
        ?.showRecent ?? false
    );
  }

  get showContrastChecker(): boolean {
    return (
      (this.args.configuration as ColorFieldConfiguration)?.options
        ?.showContrastChecker ?? false
    );
  }

  get maxHistory(): number {
    return (
      (this.args.configuration as ColorFieldConfiguration)?.options
        ?.maxHistory ?? 8
    );
  }

  get displayColor(): string | null {
    // Use local color during dragging, fall back to model
    return this.localColor ?? this.args.model;
  }

  normalizeColor(color: string | null | undefined): string | null {
    if (!color) return null;
    const { rgba, valid } = parseCssColorSafe(color);
    if (!valid) return null;
    return rgbaToHex(rgba, rgba.a < 1).toUpperCase();
  }

  @action
  handleColorChange(newColor: string | null) {
    const normalized = this.normalizeColor(newColor);

    // Update local color immediately for smooth UI
    this.localColor = newColor;

    // Clear any pending debounced save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    // Clear any pending debounced history append
    if (this.recentColorTimeout) {
      clearTimeout(this.recentColorTimeout);
      this.recentColorTimeout = null;
    }

    // Debounce the actual save to prevent lag
    this.saveTimeout = setTimeout(() => {
      this.args.set?.(newColor);
      this.saveTimeout = null;
    }, 300);

    // DEBOUNCE the history update (wait 500ms after user stops picking)
    // This matches the React pattern exactly
    this.recentColorTimeout = setTimeout(() => {
      const prevColor = this.previousColorRef;

      // Only add if color actually changed and previous color exists
      if (
        prevColor &&
        prevColor !== normalized &&
        !this.recentColors.includes(prevColor)
      ) {
        this.recentColors = [prevColor, ...this.recentColors].slice(
          0,
          this.maxHistory,
        );
      }

      // Update the ref INSIDE the timeout (like React's useRef)
      this.previousColorRef = normalized;
      this.recentColorTimeout = null;
    }, 500);
  }

  @action
  handleRecentColorSelect(color: string) {
    // Clear any pending saves
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    // Clear any pending history updates (like React does)
    if (this.recentColorTimeout) {
      clearTimeout(this.recentColorTimeout);
      this.recentColorTimeout = null;
    }

    // When clicking a recent color, set it immediately without adding to history
    this.localColor = color;
    this.args.set?.(color);
    this.previousColorRef = this.normalizeColor(color);
  }

  <template>
    <div class='color-field-editor'>
      <div class='variant-section'>
        {{#if (eq this.variant 'advanced')}}
          <AdvancedEdit
            @model={{this.displayColor}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else if (eq this.variant 'swatches-picker')}}
          <SwatchesPickerEdit
            @model={{this.displayColor}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else if (eq this.variant 'slider')}}
          <SliderEdit
            @model={{this.displayColor}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else if (eq this.variant 'wheel')}}
          <ColorWheelEdit
            @model={{this.displayColor}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else}}
          <ColorPicker
            @color={{this.displayColor}}
            @onChange={{this.handleColorChange}}
            @disabled={{not @canEdit}}
          />
        {{/if}}
      </div>

      {{#if (or this.showRecent this.showContrastChecker)}}
        <div class='addons-section'>
          {{#if this.showRecent}}
            <RecentColorsAddon
              @model={{this.displayColor}}
              @recentColors={{this.recentColors}}
              @onSelectColor={{this.handleRecentColorSelect}}
              @canEdit={{@canEdit}}
            />
          {{/if}}

          {{#if this.showContrastChecker}}
            <ContrastCheckerAddon
              @model={{this.displayColor}}
              @set={{@set}}
              @canEdit={{@canEdit}}
              @configuration={{@configuration}}
            />
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .color-field-editor {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .variant-section {
        width: 100%;
      }

      .addons-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
    </style>
  </template>
}
