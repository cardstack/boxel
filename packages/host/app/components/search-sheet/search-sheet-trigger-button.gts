import Component from '@glimmer/component';

import { IconSearch } from '@cardstack/boxel-ui/icons';

import OperatorModeIconButton from '@cardstack/host/components/operator-mode/icon-button';

interface Signature {
  Element: HTMLButtonElement;
}

export default class SearchSheetTriggerButton extends Component<Signature> {
  <template>
    <OperatorModeIconButton
      @round={{true}}
      @icon={{IconSearch}}
      @iconWidth='19'
      @iconHeight='19'
      aria-label='Search'
      ...attributes
      data-test-open-search-field
    />
  </template>
}
