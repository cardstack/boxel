import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import { getCard } from '@cardstack/host/resources/card-resource';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import AiAssistantSkillMenu from './index';

import type { Skill } from './index';

export default class AiAssistantSkillMenuUsage extends Component {
  @tracked skills: Skill[] = [];

  @action attachSkill(card: SkillCard) {
    this.skills = [
      ...this.skills,
      new TrackedObject({
        cardResource: getCard(this, () => card.id),
        isActive: true,
      }),
    ];
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
          @onChooseCard={{this.attachSkill}}
        />
        <CardCatalogModal />
      </:example>
    </FreestyleUsage>
  </template>
}
