import { Component } from 'https://cardstack.com/base/card-api';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

const THEME_CODE_REF_OPTIONS: Array<{ label: string; ref: ResolvedCodeRef }> = [
  {
    label: 'Style Reference',
    ref: {
      module: 'https://cardstack.com/base/style-reference',
      name: 'StyleReference',
    },
  },
  {
    label: 'Brand Guide',
    ref: {
      module: 'https://cardstack.com/base/brand-guide',
      name: 'BrandGuide',
    },
  },
  {
    label: 'Structured Theme',
    ref: {
      module: 'https://cardstack.com/base/structured-theme',
      name: 'StructuredTheme',
    },
  },
];

class ThemeCodeRefEdit extends Component<typeof ThemeCodeRefField> {
  options = THEME_CODE_REF_OPTIONS;

  get selected() {
    let current = this.args.model;
    if (!current) {
      return null;
    }
    return (
      this.options.find(
        (option) =>
          option.ref.module === current.module &&
          option.ref.name === current.name,
      ) ?? null
    );
  }

  <template>
    <BoxelSelect
      @placeholder='Select theme type'
      @options={{this.options}}
      @selected={{this.selected}}
      @onChange={{this.onSelect}}
      @disabled={{if @canEdit false true}}
      as |option|
    >
      {{option.label}}
    </BoxelSelect>
  </template>

  onSelect = (option: { label: string; ref: ResolvedCodeRef } | null) => {
    this.args.set(option ? option.ref : null);
  };
}

export default class ThemeCodeRefField extends CodeRefField {
  static edit = ThemeCodeRefEdit;
}
