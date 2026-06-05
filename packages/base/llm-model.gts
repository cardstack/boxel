import { Component } from './card-api';
import StringField from './string';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import { DEFAULT_FALLBACK_MODELS } from '@cardstack/runtime-common';

const LLM_MODEL_OPTIONS = DEFAULT_FALLBACK_MODELS.map((m) => ({
  value: m.modelId,
  label: m.displayName,
}));

class LLMModelEdit extends Component<typeof LLMModelField> {
  options = LLM_MODEL_OPTIONS;

  get selected() {
    let current = this.args.model;
    if (!current) {
      return null;
    }
    return (
      this.options.find((option) => option.value === current) ?? {
        value: current,
        label: current,
      }
    );
  }

  onSelect = (option: { value: string; label: string } | null) => {
    this.args.set?.(option?.value ?? null);
  };

  <template>
    <BoxelSelect
      @placeholder='Select LLM model'
      @options={{this.options}}
      @selected={{this.selected}}
      @onChange={{this.onSelect}}
      @disabled={{if @canEdit false true}}
      as |option|
    >
      {{option.label}}
    </BoxelSelect>
  </template>
}

export default class LLMModelField extends StringField {
  static displayName = 'LLM Model';
  static edit = LLMModelEdit;

  static markdown = class Markdown extends Component<typeof LLMModelField> {
    get text() {
      let value = this.args.model;
      if (value == null || value === '') {
        return '';
      }
      let match = DEFAULT_FALLBACK_MODELS.find((m) => m.modelId === value);
      // Escape so label metacharacters don't leak into the document.
      return markdownEscape(match?.displayName ?? value);
    }
    <template>{{this.text}}</template>
  };
}
