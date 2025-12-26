import Component from '@glimmer/component';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { debounce } from 'lodash';
import { eq, or, not } from '@cardstack/boxel-ui/helpers';
import { ColorPicker } from '@cardstack/boxel-ui/components';

import type {
  ColorFieldBaseOptions,
  ColorFieldConfiguration,
  ColorVariant,
} from '../util/color-utils';
import { normalizeColorForHistory } from '../util/color-utils';
import type { ColorFieldSignature } from '../util/color-field-signature';
import AdvancedColorPicker from './advanced-color-picker';
import SwatchesPicker from './swatches-picker';
import SliderPicker from './slider-picker';
import ColorWheelPicker from './color-wheel-picker';
import RecentColorsAddon from './recent-colors-addon';
import ContrastCheckerAddon from './contrast-checker-addon';

// Global storage for recentColors keyed by configuration
// Module-level: persists across component recreation within the same page session
const recentColorsStorage = new WeakMap<
  ColorFieldConfiguration | object,
  string[]
>();

export default class ColorPickerField extends Component<ColorFieldSignature> {
  @tracked recentColors: string[] = [];

  private debouncedSetColor = debounce((color: string | null) => {
    this.args.set?.(color);
  }, 300);

  private debouncedRecordRecentColor = debounce((color: string) => {
    this.recordRecentColor(color);
  }, 300);

  constructor(owner: Owner, args: ColorFieldSignature['Args']) {
    super(owner, args);
    // Restore recentColors from storage if available
    const stored = recentColorsStorage.get(this.configKey);
    if (stored) {
      this.recentColors = [...stored];
    }
  }

  // Use configuration as key for persistent storage
  // Always ensure we have an object (WeakMap requires object keys)
  get configKey(): ColorFieldConfiguration | object {
    return (this.args.configuration as ColorFieldConfiguration) || {};
  }

  get variant(): ColorVariant {
    return (
      (this.args.configuration as ColorFieldConfiguration)?.variant ??
      'standard'
    );
  }

  // At class level, add this private helper
  private get baseOptions(): ColorFieldBaseOptions | undefined {
    const configuration = this.args.configuration as
      | ColorFieldConfiguration
      | undefined;
    if (!configuration) {
      return undefined;
    }
    if (configuration.variant === 'advanced') {
      return undefined;
    }
    return configuration.options as ColorFieldBaseOptions | undefined;
  }

  get showRecent(): boolean {
    return this.baseOptions?.showRecent ?? false;
  }

  get showContrastChecker(): boolean {
    return this.baseOptions?.showContrastChecker ?? false;
  }

  get maxRecentHistory(): number {
    return this.baseOptions?.maxRecentHistory ?? 10;
  }

  @action recordRecentColor(color: string) {
    // Normalize and validate the color - this ensures we only store valid colors
    // in a consistent format (hex uppercase)
    const normalized = normalizeColorForHistory(color);
    if (!normalized) {
      // Color is invalid, don't store it
      return;
    }

    // Guard clause: Don't store if color is already in the array
    const current = recentColorsStorage.get(this.configKey) || [];
    if (current.includes(normalized)) {
      return;
    }

    const updated = [normalized, ...current].slice(0, this.maxRecentHistory);
    this.recentColors = updated;
    // Persist to storage
    recentColorsStorage.set(this.configKey, updated);
  }

  @action
  handleColorChange(newColor: string | null) {
    // Debounce the actual set call to avoid excessive updates
    this.debouncedSetColor(newColor);
    // Debounce recording recent color to avoid excessive history updates
    if (newColor) {
      this.debouncedRecordRecentColor(newColor);
    }
  }

  @action
  handleColorChangeImmediate(newColor: string | null) {
    this.args.set?.(newColor);
  }

  @action
  handleRecentColorSelect(color: string) {
    this.debouncedSetColor(color);
  }

  @action
  clearRecentColors() {
    this.recentColors = [];
    recentColorsStorage.delete(this.configKey);
  }

  willDestroy() {
    super.willDestroy();
    // Cancel any pending debounced calls
    this.debouncedSetColor.cancel();
    this.debouncedRecordRecentColor.cancel();
  }

  <template>
    <div class='color-field-editor'>
      <div class='variant-section'>
        {{#if (eq this.variant 'advanced')}}
          <AdvancedColorPicker
            @model={{@model}}
            @set={{this.handleColorChangeImmediate}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else if (eq this.variant 'swatches-picker')}}
          <SwatchesPicker
            @model={{@model}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else if (eq this.variant 'slider')}}
          <SliderPicker
            @model={{@model}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else if (eq this.variant 'wheel')}}
          <ColorWheelPicker
            @model={{@model}}
            @set={{this.handleColorChange}}
            @canEdit={{@canEdit}}
            @configuration={{@configuration}}
          />
        {{else}}
          <ColorPicker
            @color={{@model}}
            @onChange={{this.handleColorChange}}
            @disabled={{not @canEdit}}
          />
        {{/if}}
      </div>

      {{#if (or this.showRecent this.showContrastChecker)}}
        <div class='addons-section'>
          {{#if this.showRecent}}
            <RecentColorsAddon
              @model={{@model}}
              @recentColors={{this.recentColors}}
              @onSelectColor={{this.handleRecentColorSelect}}
              @onClear={{this.clearRecentColors}}
              @canEdit={{@canEdit}}
            />
          {{/if}}

          {{#if this.showContrastChecker}}
            <ContrastCheckerAddon
              @model={{@model}}
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
