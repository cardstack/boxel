// import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
// import { TrackedArray } from 'tracked-built-ins';

// import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import type { PillMenuItem } from '@cardstack/host/components/pill-menu';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import AiAssistantSkillMenu from './index';

export default class AiAssistantSkillMenuUsage extends Component {
  @tracked skills: PillMenuItem[] = [];

  @action headerAction() {
    console.log('header button clicked');
  }

  @action onChooseCard(card: CardDef) {
    this.skills = [...this.skills, { card, isActive: true }];
  }

  <template>
    <FreestyleUsage @name='AiAssistant::SkillMenu'>
      <:description>
        Component with a header and a list of card pills.
      </:description>
      <:example>
        <AiAssistantSkillMenu
          @skills={{this.skills}}
          @onChooseCard={{this.onChooseCard}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='skills'
          @description='SkillCards to be displayed on the menu.'
          @value={{this.skills}}
        />
        <Args.Action
          @name='onChooseCard'
          @description='Action to take when a card is selected from the catalog'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
