import { service } from '@ember/service';
import Component from '@glimmer/component';

import { ComponentLike } from '@glint/template';
import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleSection from 'ember-freestyle/components/freestyle-section';

import { pageTitle } from 'ember-page-title';

import { provide } from 'ember-provide-consume-context';

import RouteTemplate from 'ember-route-template';

import {
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import AiAssistantApplyButtonUsage from '@cardstack/host/components/ai-assistant/apply-button/usage';
import AiAssistantAttachmentPickerUsage from '@cardstack/host/components/ai-assistant/attachment-picker/usage';
import AiAssistantChatInputUsage from '@cardstack/host/components/ai-assistant/chat-input/usage';
import AiAssistantFocusPillUsage from '@cardstack/host/components/ai-assistant/focus-pill/usage';
import AiAssistantMessageUsage from '@cardstack/host/components/ai-assistant/message/usage';
import AiAssistantSkillMenuUsage from '@cardstack/host/components/ai-assistant/skill-menu/usage';
import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
import PillMenuUsage from '@cardstack/host/components/pill-menu/usage';
import SearchSheetUsage from '@cardstack/host/components/search-sheet/usage';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import formatComponentName from '../helpers/format-component-name';

import type StoreService from '../services/store';

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

interface HostFreestyleSignature {
  Args: {};
}

class HostFreestyleComponent extends Component<HostFreestyleSignature> {
  @service private declare store: StoreService;
  formatComponentName = formatComponentName;

  @provide(GetCardContextName)
  // @ts-ignore "getCard" is declared but not used
  private get getCard() {
    return getCard;
  }

  @provide(GetCardsContextName)
  // @ts-ignore "getCards" is declared but not used
  private get getCards() {
    return this.store.getSearchResource.bind(this.store);
  }

  @provide(GetCardCollectionContextName)
  // @ts-ignore "getCardCollection" is declared but not used
  private get getCardCollection() {
    return getCardCollection;
  }

  get usageComponents() {
    return [
      ['AiAssistant::ApplyButton', AiAssistantApplyButtonUsage],
      ['AiAssistant::CardPicker', AiAssistantAttachmentPickerUsage],
      ['AiAssistant::ChatInput', AiAssistantChatInputUsage],
      ['AiAssistant::FocusPill', AiAssistantFocusPillUsage],
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
