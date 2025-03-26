import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import { type getCard } from '@cardstack/runtime-common';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import type { RoomSkill } from '@cardstack/host/resources/room';

import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import AiAssistantSkillMenu from './index';

export default class AiAssistantSkillMenuUsage extends Component {
  @tracked skills: RoomSkill[] = [];

  @action attachSkill(cardResource: ReturnType<getCard<SkillCard>>) {
    this.skills = [
      ...this.skills,
      new TrackedObject({
        cardId: cardResource.url!,
        skillEventId: 'abc123',
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
          @cardChoosingOwner={{this}}
          @onChooseCard={{this.attachSkill}}
        />
        <CardCatalogModal />
      </:example>
    </FreestyleUsage>
  </template>
}
