import { Component, FieldDef } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { contains, field } from 'https://cardstack.com/base/card-api';

class AtomTemplate extends Component<typeof MapConfigField> {
  get displayValue() {
    const tileserverUrl = this.args.model?.tileserverUrl;
    const singleZoom = this.args.model?.singleZoom;
    const disableMapClick = this.args.model?.disableMapClick;

    if (tileserverUrl) {
      return `Custom tileserver: ${tileserverUrl}`;
    }

    if (singleZoom) {
      return `Zoom: ${singleZoom}`;
    }

    if (disableMapClick) {
      return 'Map clicks disabled';
    }

    return 'Default map settings';
  }

  <template>
    <div class='map-config-display'>
      <span class='config-info'>{{this.displayValue}}</span>
    </div>

    <style scoped>
      .map-config-display {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-shrink: 0;
      }

      .config-info {
        font-size: 14px;
        color: var(--boxel-text-muted);
        line-height: normal;
      }
    </style>
  </template>
}

class EditTemplate extends Component<typeof MapConfigField> {
  get tileserverUrlValue() {
    return this.args.model?.tileserverUrl || '';
  }

  get singleZoomValue() {
    return this.args.model?.singleZoom || 13;
  }

  get fitBoundsPaddingValue() {
    return this.args.model?.fitBoundsPadding || 32;
  }

  get disableMapClickValue() {
    return this.args.model?.disableMapClick || false;
  }

  @action
  updateTileserverUrl(value: string) {
    if (this.args.model) {
      this.args.model.tileserverUrl = value || undefined;
    }
  }

  @action
  updateSingleZoom(value: string) {
    if (this.args.model) {
      const numValue = parseInt(value, 10);
      this.args.model.singleZoom = isNaN(numValue) ? 13 : numValue;
    }
  }

  @action
  updateFitBoundsPadding(value: string) {
    if (this.args.model) {
      const numValue = parseInt(value, 10);
      this.args.model.fitBoundsPadding = isNaN(numValue) ? 32 : numValue;
    }
  }

  @action
  updateDisableMapClick(event: Event) {
    if (this.args.model) {
      const target = event.target as HTMLInputElement;
      this.args.model.disableMapClick = target.checked;
    }
  }

  <template>
    <div class='edit-template'>
      <div class='config-section'>
        <h4 class='section-title'>Map Configuration</h4>
        <p class='section-description'>
          Configure map display settings and behavior
        </p>
      </div>

      <div class='field-group'>
        <label class='field-label'>Tile Server URL</label>
        <BoxelInput
          type='text'
          placeholder='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          @value={{this.tileserverUrlValue}}
          @onInput={{this.updateTileserverUrl}}
        />
        <div class='field-help'>
          Leave empty to use default OpenStreetMap tiles
        </div>
      </div>

      <div class='field-group'>
        <label class='field-label'>Default Zoom Level</label>
        <BoxelInput
          type='number'
          min='1'
          max='18'
          @value={{this.singleZoomValue}}
          @onInput={{this.updateSingleZoom}}
        />
        <div class='field-help'>
          Zoom level when displaying a single point (1-18)
        </div>
      </div>

      <div class='field-group'>
        <label class='field-label'>Fit Bounds Padding</label>
        <BoxelInput
          type='number'
          min='0'
          max='100'
          @value={{this.fitBoundsPaddingValue}}
          @onInput={{this.updateFitBoundsPadding}}
        />
        <div class='field-help'>
          Padding around map bounds in pixels
        </div>
      </div>

      <div class='field-group'>
        <label class='field-label'>Map Behavior</label>
        <div class='checkbox-group'>
          <label class='checkbox-label'>
            <input
              type='checkbox'
              checked={{this.disableMapClickValue}}
              {{on 'change' this.updateDisableMapClick}}
            />
            <span class='checkbox-text'>Disable map click events</span>
          </label>
        </div>
        <div class='field-help'>
          When enabled, clicking on the map won't trigger events
        </div>
      </div>
    </div>

    <style scoped>
      .edit-template {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-md);
      }

      .config-section {
        border-bottom: 1px solid var(--boxel-border-color);
        padding-bottom: var(--boxel-sp-md);
      }

      .section-title {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--boxel-text-color);
      }

      .section-description {
        margin: 0;
        font-size: 14px;
        color: var(--boxel-text-muted);
        line-height: 1.4;
      }

      .field-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .field-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--boxel-text-color);
      }

      .field-help {
        font-size: 12px;
        color: var(--boxel-text-muted);
        line-height: 1.3;
      }

      .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .checkbox-label {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        cursor: pointer;
        font-size: 14px;
      }

      .checkbox-label input[type='checkbox'] {
        margin: 0;
      }

      .checkbox-text {
        color: var(--boxel-text-color);
      }
    </style>
  </template>
}

export class MapConfigField extends FieldDef {
  static displayName = 'Map Configuration';

  @field tileserverUrl = contains(StringField);
  @field singleZoom = contains(NumberField);
  @field fitBoundsPadding = contains(NumberField);
  @field disableMapClick = contains(BooleanField);

  static atom = AtomTemplate;
  static embedded = EditTemplate;
}
