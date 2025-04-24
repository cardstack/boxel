import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import type { RoomSkill } from '@cardstack/host/resources/room';

import AiAssistantSkillMenu from './index';

export default class AiAssistantSkillMenuUsage extends Component {
  @tracked skills: RoomSkill[] = [];

  @action attachSkill(cardId: string) {
    this.skills = [
      ...this.skills,
      new TrackedObject({
        cardId,
        fileDef: {
          sourceUrl: cardId,
          url: cardId,
          name: cardId,
          contentType: 'text/plain',
        },
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
