import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { DropdownButton } from '@cardstack/boxel-ui/components';
import type RealmInfoService from '../services/realm-info-service';

interface Signature {
  Args: {
    selectedRealm: string | undefined;
    onSelect: (path: string) => void;
    disabled?: boolean;
  };
  Element: HTMLElement;
}

export default class RealmDropdown extends Component<Signature> {
  <template>
    <DropdownButton
      class='realm-dropdown-button'
      @items={{this.realms}}
      @onSelect={{@onSelect}}
      @selectedItem={{@selectedRealm}}
      @disabled={{@disabled}}
      @kind='secondary-light'
      @size='small'
      data-test-realm-dropdown
      ...attributes
    >
      {{if @selectedRealm 'Change' 'Select'}}
    </DropdownButton>
  </template>

  @service declare realmInfoService: RealmInfoService;
  @tracked realms: string[] | [] = [];

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.realms = this.realmInfoService.getAllKnownRealmPaths();
  }
}
