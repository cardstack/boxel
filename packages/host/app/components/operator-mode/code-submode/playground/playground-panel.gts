import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
import { consume } from 'ember-provide-consume-context';

import { BoxelSelect, LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  internalKeyFor,
  type ResolvedCodeRef,
  GetCardContextName,
  type getCard,
  chooseCard,
  loadCardDef,
  specRef,
  type Query,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type StoreService from '@cardstack/host/services/store';

import type {
  CardDef,
  FieldDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import { FieldOption, SelectedInstance } from './playground-content';

import PlaygroundContent from './playground-content';
import PlaygroundTitle from './playground-title';

import type { PrerenderedCard } from '../../../prerendered-card-search';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Args: {
    codeRef: ResolvedCodeRef;
    isFieldDef?: boolean;
    isUpdating?: boolean;
  };
  Element: HTMLElement;
  Blocks: {
    default: [
      WithBoundArgs<
        typeof PlaygroundTitle,
        | 'makeCardResource'
        | 'query'
        | 'recentRealms'
        | 'fieldOptions'
        | 'selection'
        | 'onSelect'
        | 'chooseCard'
        | 'createNew'
        | 'createNewIsRunning'
        | 'canWriteRealm'
        | 'field'
        | 'onFieldSelect'
        | 'closeFieldChooser'
        | 'fieldChooserIsOpen'
        | 'chooseField'
      >,
      (
        | WithBoundArgs<
            typeof PlaygroundContent,
            | 'makeCardResource'
            | 'card'
            | 'field'
            | 'moduleId'
            | 'codeRef'
            | 'createNew'
            | 'createNewIsRunning'
            | 'isFieldDef'
          >
        | WithBoundArgs<typeof LoadingIndicator, never>
      ),
    ];
  };
}

export default class PlaygroundPanel extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare store: StoreService;

  @tracked private cardResource: ReturnType<getCard> | undefined;
  @tracked private fieldChooserIsOpen = false;

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
    return this.recentFilesService.recentFiles
      .map((f) => `${f.realmURL}${f.filePath}`)
      .filter((id) => id.endsWith('.json'))
      .map((id) => id.slice(0, -1 * '.json'.length));
  }

  private get recentRealms() {
    return [
      ...new Set(
        this.recentFilesService.recentFiles.map((f) => f.realmURL.href),
      ),
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
      sort: [
        {
          by: 'createdAt',
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
      this.persistSelections(
        (item as PrerenderedCard).url.replace(/\.json$/, ''),
      );
    }
  }

  private get currentRealm() {
    return this.operatorModeStateService.realmURL.href;
  }

  private get canWriteRealm() {
    return this.realm.canWrite(this.currentRealm);
  }

  @action handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  @action
  private onFieldSelect(index: number) {
    if (!this.card?.id) {
      return;
    }
    this.persistSelections(this.card.id, this.format, index);
  }

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
        cardId === selectedCardId &&
        format === selectedFormat &&
        fieldIndex === index
      ) {
        return;
      }
    }
    this.playgroundPanelService.persistSelections(
      this.moduleId,
      selectedCardId,
      selectedFormat,
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
    this.args.isFieldDef && this.card
      ? this.createNewField.perform(this.card as Spec)
      : this.createNewCard.perform();
  }

  private get createNewIsRunning() {
    return this.createNewCard.isRunning || this.createNewField.isRunning;
  }

  private createNewCard = restartableTask(async () => {
    let newCardJSON: LooseSingleCardDocument;
    if (this.args.isFieldDef) {
      let fieldCard = await loadCardDef(this.args.codeRef, {
        loader: this.loaderService.loader,
      });
      // for field def, create a new spec card instance
      newCardJSON = {
        data: {
          attributes: {
            specType: 'field',
            ref: this.args.codeRef,
            title: this.args.codeRef.name,
            containedExamples: [new fieldCard()],
          },
          meta: {
            fields: {
              containedExamples: [
                {
                  adoptsFrom: this.args.codeRef,
                },
              ],
            },
            adoptsFrom: specRef,
            realmURL: this.currentRealm,
          },
        },
      };
    } else {
      newCardJSON = {
        data: {
          meta: {
            adoptsFrom: this.args.codeRef,
            realmURL: this.currentRealm,
          },
        },
      };
    }
    let cardId = await this.store.create(
      newCardJSON,
      undefined,
      this.currentRealm,
    );
    if (typeof cardId === 'string') {
      this.recentFilesService.addRecentFileUrl(`${cardId}.json`);
      this.persistSelections(
        cardId,
        'edit',
        this.args.isFieldDef ? 0 : undefined,
      ); // open new instance in playground in edit format
      this.closeInstanceChooser();
    }
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

  <template>
    {{yield
      (component
        PlaygroundTitle
        makeCardResource=this.makeCardResource
        query=this.query
        recentRealms=this.recentRealms
        fieldOptions=this.fieldInstances
        selection=this.dropdownSelection
        onSelect=this.onSelect
        chooseCard=this.chooseInstance
        createNew=this.createNew
        createNewIsRunning=this.createNewIsRunning
        canWriteRealm=this.canWriteRealm
        field=this.field
        fieldChooserIsOpen=this.fieldChooserIsOpen
        onFieldSelect=this.onFieldSelect
        closeFieldChooser=this.closeFieldChooser
        chooseField=this.chooseField
      )
      (if
        this.isLoading
        (component LoadingIndicator color='var(--boxel-light)')
        (component
          PlaygroundContent
          makeCardResource=this.makeCardResource
          card=this.card
          field=this.field
          moduleId=this.moduleId
          codeRef=@codeRef
          createNew=this.createNew
          createNewIsRunning=this.createNewIsRunning
          isFieldDef=@isFieldDef
        )
      )
    }}
  </template>
}
