import { hash } from '@ember/helper';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';
import { htmlSafe, type SafeString } from '@ember/template';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';
import { consume } from 'ember-provide-consume-context';

import {
  BoxelSelect,
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode, IconLink } from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import {
  internalKeyFor,
  type ResolvedCodeRef,
  GetCardContextName,
  type getCard,
  chooseCard,
  loadCardDef,
  specRef,
  trimJsonExtension,
  localId,
  type Query,
  type CardErrorJSONAPI,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type LoaderService from '@cardstack/host/services/loader-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type { RecentCard } from '@cardstack/host/services/recent-cards-service';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type StoreService from '@cardstack/host/services/store';

import type {
  CardDef,
  FieldDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import CardError from '../../card-error';
import FormatChooser from '../format-chooser';

import FieldPickerModal from './field-chooser-modal';

import InstanceSelectDropdown from './instance-chooser-dropdown';
import PlaygroundPreview from './playground-preview';
import SpecSearch from './spec-search';

import type { PrerenderedCard } from '../../../prerendered-card-search';

export type SelectedInstance = {
  card: CardDef;
  fieldIndex: number | undefined;
};

export type FieldOption = {
  index: number;
  displayIndex: number;
  field: FieldDef;
};

interface Signature {
  Args: {
    codeRef: ResolvedCodeRef;
    isFieldDef?: boolean;
    isUpdating?: boolean;
  };
  Element: HTMLElement;
}

export default class PlaygroundPanel extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare recentCardsService: RecentCardsService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare store: StoreService;

  @tracked private cardResource: ReturnType<getCard> | undefined;
  @tracked private fieldChooserIsOpen = false;

  private fieldFormats: Format[] = ['embedded', 'fitted', 'atom', 'edit'];

  private get specQuery(): Query {
    return {
      filter: {
        on: specRef,
        eq: { ref: this.args.codeRef },
      },
      sort: [
        {
          by: 'lastModified',
          direction: 'desc',
        },
      ],
    };
  }

  private get maybeGenerateFieldSpec() {
    return this.args.isFieldDef && !this.card;
  }

  private copyToClipboard = task(async (id: string) => {
    await navigator.clipboard.writeText(id);
  });

  private openInInteractMode = (id: string) => {
    this.operatorModeStateService.openCardInInteractMode(
      id,
      this.format === 'edit' ? 'edit' : 'isolated',
    );
  };

  private get showError() {
    // in edit format, prefer showing the stale card if possible so user can
    // attempt to fix the card error
    if (this.cardError && this.format === 'edit' && this.card) {
      return false;
    }
    return Boolean(this.cardError);
  }

  private get contextMenuItems() {
    if (!this.card?.id) {
      return undefined;
    }
    let cardId = this.card.id;
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(cardId),
        icon: IconLink,
      }),
      new MenuItem('Open in Code Mode', 'action', {
        action: () =>
          this.operatorModeStateService.updateCodePath(new URL(cardId)),
        icon: IconCode,
      }),
      new MenuItem('Open in Interact Mode', 'action', {
        action: () => this.openInInteractMode(cardId),
        icon: Eye,
      }),
    ];
    return menuItems;
  }

  @action private setFormat(format: Format) {
    if (!this.card?.id) {
      return;
    }
    this.persistToLocalStorage(this.card.id, format);
  }

  private get realmInfo() {
    let url = this.card ? urlForRealmLookup(this.card) : undefined;
    if (!url) {
      return undefined;
    }
    return this.realm.info(url);
  }

  private get canEditCard() {
    return Boolean(
      this.format !== 'edit' &&
        this.card?.id &&
        this.realm.canWrite(this.card.id),
    );
  }

  private get isWideFormat() {
    if (!this.card) {
      return false;
    }
    let { constructor } = this.card;
    return Boolean(
      constructor &&
        'prefersWideFormat' in constructor &&
        constructor.prefersWideFormat,
    );
  }

  private get styleForPlaygroundContent(): SafeString {
    const maxWidth =
      this.format !== 'isolated' || this.isWideFormat ? '100%' : '50rem';
    return htmlSafe(`max-width: ${maxWidth};`);
  }
  private get moduleId() {
    return internalKeyFor(this.args.codeRef, undefined);
  }

  private get isLoading() {
    return this.args.isFieldDef && this.args.isUpdating;
  }

  private makeCardResource = () => {
    this.cardResource = this.getCard(
      this,
      () => this.playgroundSelection?.cardId,
    );
  };

  private get playgroundSelection() {
    return this.playgroundPanelService.getSelection(this.moduleId);
  }

  private get card(): CardDef | undefined {
    return this.cardResource?.card;
  }

  private get cardError(): CardErrorJSONAPI | undefined {
    return this.cardResource?.cardError;
  }

  private get specCard(): Spec | undefined {
    let card = this.card;
    if (!card || !this.args.isFieldDef) {
      return undefined;
    }
    if (!('ref' in card) || !('moduleHref' in card)) {
      return undefined;
    }
    if (
      card.moduleHref !== this.args.codeRef.module ||
      (card.ref as ResolvedCodeRef).name !== this.args.codeRef.name
    ) {
      return undefined;
    }
    return card as Spec;
  }

  private get recentCardIds() {
    let cards: RecentCard[] = [];
    for (let file of this.recentFilesService.recentFiles) {
      let url = `${file.realmURL}${file.filePath}`;
      if (url.endsWith('.json') && file.timestamp) {
        cards.push({
          cardId: trimJsonExtension(url),
          timestamp: file.timestamp,
        });
      }
    }
    let recentCards = this.recentCardsService.recentCards.filter((c) =>
      Boolean(c.timestamp),
    );
    let sortedCards = [...recentCards, ...cards].sort(
      (a, b) => b.timestamp! - a.timestamp!,
    );
    return [...new Set(sortedCards.map((c) => c.cardId))];
  }

  private get recentRealms() {
    return [
      ...new Set([
        this.currentRealm,
        ...this.recentFilesService.recentFiles.map((f) => f.realmURL.href),
      ]),
    ];
  }

  private get query(): Query | undefined {
    if (this.args.isFieldDef) {
      return undefined;
    }
    return {
      filter: {
        every: [
          {
            type: this.args.codeRef,
          },
          {
            any: this.recentCardIds.map((id) => ({ eq: { id } })).slice(0, 20),
          },
        ],
      },
    };
  }

  private get expandedQuery(): Query | undefined {
    if (this.args.isFieldDef) {
      return undefined;
    }
    return {
      filter: { type: this.args.codeRef },
      sort: [
        {
          by: 'lastModified',
          direction: 'desc',
        },
      ],
    };
  }

  private get fieldInstances(): FieldOption[] | undefined {
    if (!this.args.isFieldDef || !this.specCard) {
      return undefined;
    }
    let spec = this.specCard;
    let instances = spec.containedExamples;
    if (!instances?.length) {
      this.createNewField.perform(spec);
      return undefined;
    }
    return instances.map((field, i) => ({
      index: i,
      displayIndex: i + 1,
      field,
    }));
  }

  private get field(): FieldDef | undefined {
    if (!this.fieldInstances) {
      return undefined;
    }
    let index = this.fieldIndex!;
    if (index >= this.fieldInstances.length) {
      index = this.fieldInstances.length - 1;
    }
    return this.fieldInstances[index].field;
  }

  private get fieldIndex(): number | undefined {
    let index = this.playgroundPanelService.getSelection(
      this.moduleId,
    )?.fieldIndex;
    if (index !== undefined && index >= 0) {
      return index;
    }
    return this.args.isFieldDef ? 0 : undefined;
  }

  private get dropdownSelection(): SelectedInstance | undefined {
    if (!this.card) {
      return undefined;
    }
    return {
      card: this.card,
      fieldIndex: this.args.isFieldDef ? this.fieldIndex : undefined,
    };
  }

  @action private onSelect(item: PrerenderedCard | FieldOption) {
    if (this.args.isFieldDef) {
      this.persistSelections(
        this.card!.id,
        this.format,
        (item as FieldOption).index,
      );
    } else {
      this.persistSelections((item as PrerenderedCard).url);
    }
  }

  private get currentRealm() {
    return this.operatorModeStateService.realmURL.href;
  }

  private get canWriteRealm() {
    return this.realm.canWrite(this.currentRealm);
  }

  // FIXME why is this unused?
  // @action
  // private onFieldSelect(index: number) {
  //   if (!this.card?.id) {
  //     return;
  //   }
  //   this.persistSelections(this.card.id, this.format, index);
  // }

  private get defaultFormat() {
    return this.args.isFieldDef ? 'embedded' : 'isolated';
  }

  private get format(): Format {
    return (
      this.playgroundPanelService.getSelection(this.moduleId)?.format ??
      this.defaultFormat
    );
  }

  private persistSelections = (
    selectedCardId: string,
    selectedFormat = this.format,
    index = this.fieldIndex,
  ) => {
    let selection = this.playgroundPanelService.getSelection(this.moduleId);
    if (selection?.cardId) {
      let { cardId, format, fieldIndex } = selection;
      if (
        cardId === trimJsonExtension(selectedCardId) &&
        format === selectedFormat &&
        fieldIndex === index
      ) {
        return;
      }
    }

    this.persistToLocalStorage(selectedCardId, selectedFormat, index);
  };

  private persistToLocalStorage = (
    cardId: string,
    format: Format,
    index?: number,
  ) => {
    this.playgroundPanelService.persistSelections(
      this.moduleId,
      trimJsonExtension(cardId),
      format,
      index,
    );
  };

  @action private chooseInstance() {
    this.args.isFieldDef
      ? (this.fieldChooserIsOpen = true)
      : this.chooseCard.perform();
    this.closeInstanceChooser();
  }

  @action private chooseField(index: number) {
    if (!this.card?.id) {
      return;
    }
    this.persistSelections(this.card.id, this.format, index);
    this.closeFieldChooser();
  }

  @action private closeFieldChooser() {
    this.fieldChooserIsOpen = false;
  }

  private chooseCard = task(async () => {
    let cardId = await chooseCard({
      filter: { type: this.args.codeRef },
    });

    if (cardId) {
      this.recentFilesService.addRecentFileUrl(`${cardId}.json`);
      this.persistSelections(cardId);
    }
  });

  @action private createNew() {
    this.args.isFieldDef && this.specCard
      ? this.createNewField.perform(this.specCard)
      : this.createNewCard.perform();
  }

  private get createNewIsRunning() {
    return this.createNewCard.isRunning || this.createNewField.isRunning;
  }

  private createNewCard = restartableTask(async () => {
    let cardClass = await loadCardDef(
      // for field def, create a new spec card instance
      this.args.isFieldDef ? specRef : this.args.codeRef,
      {
        loader: this.loaderService.loader,
      },
    );
    let newInstance: CardDef;
    if (this.args.isFieldDef) {
      let field = await loadCardDef(this.args.codeRef, {
        loader: this.loaderService.loader,
      });
      newInstance = new cardClass({
        specType: 'field',
        ref: this.args.codeRef,
        title: this.args.codeRef.name,
        containedExamples: [new field()],
      }) as Spec;
    } else {
      newInstance = new cardClass() as CardDef;
    }

    await this.store.add(newInstance, {
      realm: this.currentRealm,
      doNotWaitForPersist: true,
    });
    await this.recentCardsService.addNewCard(newInstance, {
      addToRecentFiles: true,
    });
    this.playgroundPanelService.persistSelections(
      this.moduleId,
      newInstance[localId],
      'edit',
      this.args.isFieldDef ? 0 : undefined,
    ); // open new instance in playground in edit format
    this.closeInstanceChooser();
  });

  private createNewField = restartableTask(async (specCard: Spec) => {
    let fieldCard = await loadCardDef(this.args.codeRef, {
      loader: this.loaderService.loader,
    });
    let examples = specCard.containedExamples;
    examples?.push(new fieldCard());
    let index = examples?.length ? examples.length - 1 : 0;
    this.persistSelections(specCard.id, 'edit', index);
    this.closeInstanceChooser();
  });

  private closeInstanceChooser = () =>
    (
      document.querySelector(
        '[data-playground-instance-chooser][aria-expanded="true"]',
      ) as BoxelSelect | null
    )?.click();

  @action
  handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  <template>
    {{consumeContext this.makeCardResource}}

    {{#if this.fieldChooserIsOpen}}
      <ToElsewhere
        @named='playground-field-picker'
        @send={{component
          FieldPickerModal
          instances=this.fieldInstances
          selectedIndex=this.dropdownSelection.fieldIndex
          onSelect=this.chooseField
          onClose=this.closeFieldChooser
          name=(if this.field (cardTypeDisplayName this.field))
        }}
      />
    {{/if}}

    {{#if this.isLoading}}
      <LoadingIndicator @color='var(--boxel-light)' />
    {{else}}
      <section class='playground-panel' data-test-playground-panel>
        <div
          class='playground-panel-content'
          style={{this.styleForPlaygroundContent}}
        >
          {{#let (if @isFieldDef this.field this.card) as |card|}}
            {{#if this.showError}}
              {{! this is for types--@cardError is always true in this case !}}
              {{#if this.cardError}}
                <CardContainer
                  class='error-container'
                  @displayBoundaries={{true}}
                  data-test-error-container
                >
                  <CardError
                    @error={{this.cardError}}
                    @cardCreationError={{this.cardError.meta.isCreationError}}
                  />
                </CardContainer>
              {{/if}}
            {{else if card}}
              <div
                class='preview-area'
                data-test-field-preview-card={{@isFieldDef}}
              >
                <PlaygroundPreview
                  @card={{card}}
                  @format={{this.format}}
                  @realmInfo={{this.realmInfo}}
                  @contextMenuItems={{this.contextMenuItems}}
                  @onEdit={{if this.canEditCard (fn this.setFormat 'edit')}}
                  @onFinishEditing={{if
                    (eq this.format 'edit')
                    (fn this.setFormat this.defaultFormat)
                  }}
                  @isFieldDef={{@isFieldDef}}
                />
              </div>
              <section class='picker-and-chooser'>
                <button
                  class='instance-chooser-container'
                  {{on 'click' this.handleClick}}
                  {{on 'mouseup' this.handleClick}}
                >
                  <InstanceSelectDropdown
                    @prerenderedCardQuery={{hash
                      query=this.query
                      realms=this.recentRealms
                    }}
                    @expandedSearchQuery={{hash
                      query=this.expandedQuery
                      realms=this.realmServer.availableRealmURLs
                    }}
                    @fieldOptions={{this.fieldInstances}}
                    @selection={{this.dropdownSelection}}
                    @onSelect={{this.onSelect}}
                    @chooseCard={{this.chooseInstance}}
                    @createNew={{if this.canWriteRealm this.createNew}}
                    @createNewIsRunning={{this.createNewIsRunning}}
                    @moduleId={{this.moduleId}}
                    @persistSelections={{this.persistToLocalStorage}}
                    @recentCardIds={{this.recentCardIds}}
                  />
                </button>
                <FormatChooser
                  class='format-chooser'
                  @formats={{if @isFieldDef this.fieldFormats}}
                  @format={{this.format}}
                  @setFormat={{this.setFormat}}
                  data-test-playground-format-chooser
                />
              </section>
            {{else if this.createNewIsRunning}}
              <LoadingIndicator @color='var(--boxel-light)' />
            {{else if this.maybeGenerateFieldSpec}}
              <SpecSearch
                @query={{this.specQuery}}
                @realms={{this.realmServer.availableRealmURLs}}
                @canWriteRealm={{this.canWriteRealm}}
                @createNewCard={{this.createNew}}
              />
            {{/if}}
          {{/let}}
        </div>
      </section>
    {{/if}}

    <style scoped>
      .instance-chooser-container {
        background: none;
        border: none;
        cursor: auto;
        width: 100%;
        padding: 0;
        margin-left: auto;
      }

      .instance-chooser-container :deep(.instance-chooser) {
        height: auto;

        border-radius: 0;
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
      }

      /* FIXME these can be styled directly in the component, which is only used here? */

      .instance-chooser-container :deep(.instance-chooser .boxel-trigger) {
        padding: var(--boxel-sp-sm);
      }

      .instance-chooser-container > :deep(.ember-basic-dropdown) {
        width: 100%;
      }

      .playground-panel-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-height: 100%;
        margin-inline: auto;
      }
      .preview-area {
        flex-grow: 1;
        z-index: 0;
        display: flex;
        flex-direction: column;
      }

      .picker-and-chooser {
        position: sticky;
        bottom: 100px;
        border: 1px solid var(--boxel-450);
        margin: 0 auto;
        width: 380px;
        justify-content: space-between;

        /* It’s meant to have two rounded borders, this removes a gap */
        border-radius: calc(var(--boxel-border-radius) + 1px);

        --boxel-format-chooser-button-bg-color: var(--boxel-dark);
      }

      .format-chooser {
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }

      .format-chooser__buttons {
        padding: var(--boxel-sp-xs);
      }

      .playground-panel {
        position: relative;
        background-image: url('./playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        height: 100%;
        width: 100%;
        background-color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: auto;
      }
      .error-container {
        flex-grow: 1;
        display: grid;
        grid-template-rows: max-content;
        margin-left: calc(-1 * var(--boxel-sp));
        width: calc(100% + calc(2 * var(--boxel-sp)));
      }
    </style>
  </template>
}
