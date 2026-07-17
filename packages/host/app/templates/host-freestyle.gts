import { service } from '@ember/service';
import Component from '@glimmer/component';

import FreestyleGuide from 'ember-freestyle/components/freestyle-guide';
import FreestyleSection from 'ember-freestyle/components/freestyle-section';

import { pageTitle } from 'ember-page-title';

import { provide } from 'ember-provide-consume-context';

import RouteTemplate from 'ember-route-template';

import {
  CardContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  type getCard as GetCardType,
} from '@cardstack/runtime-common';

import AiAssistantActionBarUsage from '@cardstack/host/components/ai-assistant/action-bar-usage';
import AiAssistantApplyButtonUsage from '@cardstack/host/components/ai-assistant/apply-button/usage';
import AiAssistantAttachmentPickerUsage from '@cardstack/host/components/ai-assistant/attachment-picker/usage';
import AiAssistantChatInputUsage from '@cardstack/host/components/ai-assistant/chat-input/usage';
import AiAssistantFocusPillUsage from '@cardstack/host/components/ai-assistant/focus-pill/usage';
import AiAssistantMessageUsage from '@cardstack/host/components/ai-assistant/message/usage';
import AiAssistantSkillMenuUsage from '@cardstack/host/components/ai-assistant/skill-menu/usage';
import MiniCardChooserUsage from '@cardstack/host/components/card-chooser/mini/usage';
import CardChooserModal from '@cardstack/host/components/card-chooser/modal';
import MiniFileChooserUsage from '@cardstack/host/components/file-chooser/mini/usage';
import MarkdownEmbedPreviewPaneUsage from '@cardstack/host/components/markdown-embed-chooser/pane-usage';
import MarkdownEmbedPreviewUsage from '@cardstack/host/components/markdown-embed-chooser/preview/usage';
import PillMenuUsage from '@cardstack/host/components/pill-menu/usage';
import SearchResults from '@cardstack/host/components/search/search-results';
import SearchSheetUsage from '@cardstack/host/components/search-sheet/usage';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import formatComponentName from '../helpers/format-component-name';

import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type { CardContext } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

interface HostFreestyleSignature {
  Args: {};
}

class HostFreestyleComponent extends Component<HostFreestyleSignature> {
  @service declare private store: StoreService;
  @service declare private toolService: ToolService;
  formatComponentName = formatComponentName;

  @provide(GetCardContextName)
  // @ts-ignore "getCard" is declared but not used
  private get getCard(): GetCardType {
    return getCard as unknown as GetCardType;
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

  // CardRenderer (used by the markdown-embed preview usages) consumes the full
  // CardContext; provide it here so previewed cards/files actually render.
  @provide(CardContextName)
  // @ts-ignore "cardContext" is declared but not used
  private get cardContext(): CardContext {
    return {
      getCard: this.getCard,
      getCards: this.store.getSearchResource.bind(this.store),
      getCardCollection,
      store: this.store,
      toolContext: this.toolService.toolContext,
      commandContext: this.toolService.toolContext,
      searchResultsComponent: SearchResults,
    };
  }

  get usageComponents() {
    return [
      ['AiAssistant::ActionBar', AiAssistantActionBarUsage],
      ['AiAssistant::ApplyButton', AiAssistantApplyButtonUsage],
      ['AiAssistant::CardPicker', AiAssistantAttachmentPickerUsage],
      ['AiAssistant::ChatInput', AiAssistantChatInputUsage],
      ['AiAssistant::FocusPill', AiAssistantFocusPillUsage],
      ['AiAssistant::Message', AiAssistantMessageUsage],
      ['AiAssistant::PillMenu', PillMenuUsage],
      ['AiAssistant::SkillMenu', AiAssistantSkillMenuUsage],
      ['MiniCardChooser', MiniCardChooserUsage],
      ['MiniFileChooser', MiniFileChooserUsage],
      ['MarkdownEmbedChooser::Preview', MarkdownEmbedPreviewUsage],
      ['MarkdownEmbedChooser::Pane', MarkdownEmbedPreviewPaneUsage],
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

    <CardChooserModal />
  </template>
}

export default RouteTemplate(HostFreestyleComponent);
