import { action } from '@ember/object';
import Component from '@glimmer/component';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedArray } from 'tracked-built-ins';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import AiAssistantSkillMenu from './index';

export default class AiAssistantSkillMenuUsage extends Component {
  skills: TrackedArray<SkillCard> = new TrackedArray();

  @action attachSkill(card: SkillCard) {
    this.skills.push(card);
  }

  <template>
    <FreestyleUsage @name='AiAssistant::CardPicker'>
      <:description>
        Allows attaching a skill card to be used by the AI Assistant. Displays
        currently attached and enabled skill cards.
      </:description>
      <:example>
        <AiAssistantSkillMenu
          @skills={{this.skills}}
          @attachSkill={{this.attachSkill}}
        />
        <CardCatalogModal />
      </:example>
    </FreestyleUsage>
  </template>
}
