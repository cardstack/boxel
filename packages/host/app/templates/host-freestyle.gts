import Component from '@glimmer/component';

import { ComponentLike } from '@glint/template';
import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleSection from 'ember-freestyle/components/freestyle-section';

import { pageTitle } from 'ember-page-title';
import RouteTemplate from 'ember-route-template';

import AiAssistantApplyButtonUsage from '@cardstack/host/components/ai-assistant/apply-button/usage';
import AiAssistantAttachmentPickerUsage from '@cardstack/host/components/ai-assistant/attachment-picker/usage';
import AiAssistantChatInputUsage from '@cardstack/host/components/ai-assistant/chat-input/usage';
import AiAssistantMessageUsage from '@cardstack/host/components/ai-assistant/message/usage';
import AiAssistantSkillMenuUsage from '@cardstack/host/components/ai-assistant/skill-menu/usage';
import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import PillMenuUsage from '@cardstack/host/components/pill-menu/usage';
import SearchSheetUsage from '@cardstack/host/components/search-sheet/usage';

import formatComponentName from '../helpers/format-component-name';

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

interface HostFreestyleSignature {
  Args: {};
}

class HostFreestyleComponent extends Component<HostFreestyleSignature> {
  formatComponentName = formatComponentName;

  get usageComponents() {
    return [
      ['AiAssistant::ApplyButton', AiAssistantApplyButtonUsage],
      ['AiAssistant::CardPicker', AiAssistantAttachmentPickerUsage],
      ['AiAssistant::ChatInput', AiAssistantChatInputUsage],
      ['AiAssistant::Message', AiAssistantMessageUsage],
      ['AiAssistant::PillMenu', PillMenuUsage],
      ['AiAssistant::SkillMenu', AiAssistantSkillMenuUsage],
      ['SearchSheet', SearchSheetUsage],
    ].map(([name, c]) => {
      return {
        title: name,
        component: c,
      };
    }) as UsageComponent[];
  }

  <template>
    {{pageTitle 'Host Components'}}

    <h1 class='boxel-sr-only'>Boxel Host Components Documentation</h1>

    <FreestyleGuide
      @title='Boxel Host Components'
      @subtitle='Living Component Documentation'
    >
      <FreestyleSection
        @name='Components'
        class='freestyle-components-section'
        as |Section|
      >
        {{#each this.usageComponents as |c|}}
          <Section.subsection @name={{this.formatComponentName c.title}}>
            <c.component />
          </Section.subsection>
        {{/each}}
      </FreestyleSection>
    </FreestyleGuide>

    <CardCatalogModal />
  </template>
}

export default RouteTemplate(HostFreestyleComponent);
