import Component from '@glimmer/component';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import AiAssistantSkillMenu from './index';

export default class AiAssistantSkillMenuUsage extends Component {
  <template>
    <FreestyleUsage @name='AiAssistant::CardPicker'>
      <:description>
        Allows attaching a skill card to be used by the AI Assistant. Displays
        currently attached and enabled skill cards.
      </:description>
      <:example>
        <AiAssistantSkillMenu />
        <CardCatalogModal />
      </:example>
    </FreestyleUsage>
  </template>
}
