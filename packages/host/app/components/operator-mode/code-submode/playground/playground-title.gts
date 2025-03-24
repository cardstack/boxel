import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { ComponentLike } from '@glint/template';
import { task } from 'ember-concurrency';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { consume } from 'ember-provide-consume-context';

import { BoxelSelect } from '@cardstack/boxel-ui/components';

import {
  cardTypeDisplayName,
  chooseCard,
  loadCard,
  specRef,
  GetCardContextName,
  type getCard,
  type Query,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/modifiers/consume-context';

import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type {
  CardDef,
  FieldDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import { type PrerenderedCard } from '../../../prerendered-card-search';

import FieldPickerModal from './field-chooser-modal';
import InstanceSelectDropdown from './instance-chooser-dropdown';
import { FieldOption, SelectedInstance } from './playground-content';

interface TitleSignature {
  Args: {
    makeCardResource: () => void;
    query: Query | undefined;
    recentRealms: string[];
    fieldOptions: FieldOption[] | undefined;
    selection: SelectedInstance | undefined;
    onSelect: (item: PrerenderedCard | FieldOption) => void;
    chooseCard: () => void;
    createNew: () => void;
    createNewIsRunning: boolean;
    canWriteRealm: boolean;
    handleClick: (e: MouseEvent) => void;
  };
}

const Title: TemplateOnlyComponent<TitleSignature> = <template>
  <div class='playground-title' {{consumeContext consume=@makeCardResource}}>
    <span>Playground</span>
    <button
      class='instance-chooser-container'
      {{on 'click' @handleClick}}
      {{on 'mouseup' @handleClick}}
    >
      <InstanceSelectDropdown
        @prerenderedCardQuery={{hash query=@query realms=@recentRealms}}
        @fieldOptions={{@fieldOptions}}
        @selection={{@selection}}
        @onSelect={{@onSelect}}
        @chooseCard={{@chooseCard}}
        @createNew={{if @canWriteRealm @createNew}}
        @createNewIsRunning={{@createNewIsRunning}}
      />
    </button>
  </div>

  <style scoped>
    .playground-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: var(--boxel-sp-xxl);
    }
    .instance-chooser-container {
      display: flex;
      justify-content: end;
      background: none;
      border: none;
      cursor: auto;
      width: 271px;
    }
    .instance-chooser-container > :deep(.ember-basic-dropdown) {
      max-width: 100%;
    }
  </style>
</template>;

interface Signature {
  Args: {
    codeRef: ResolvedCodeRef;
    moduleId: string;
    isFieldDef?: boolean;
  };
  Blocks: {
    default: [
      {
        card: CardDef | undefined;
        field: FieldDef | undefined;
        createNewFieldInstance: () => void;
        element: ComponentLike;
      },
    ];
  };
}

export default class PlaygroundTitle extends Component<Signature> {
  <template>
    {{yield
      (hash
        card=this.card
        field=this.field
        createNewFieldInstance=this.createNew
        element=(component
          Title
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
          handleClick=this.handleClick
        )
      )
    }}

    {{#if this.fieldChooserIsOpen}}
      <ToElsewhere
        @named='playground-field-picker'
        @send={{component
          FieldPickerModal
          instances=this.fieldInstances
          selectedIndex=this.fieldIndex
          onSelect=this.chooseField
          onClose=this.closeFieldChooser
          name=(if this.field (cardTypeDisplayName this.field))
        }}
      />
    {{/if}}
  </template>

  @consume(GetCardContextName) private declare getCard: getCard;

  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare recentFilesService: RecentFilesService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @tracked private newCardJSON: LooseSingleCardDocument | undefined;
  @tracked private fieldChooserIsOpen = false;
  @tracked private cardResource: ReturnType<getCard> | undefined;

  private makeCardResource = () => {
    this.cardResource = this.getCard(
      this,
      () => this.newCardJSON ?? this.playgroundSelection?.cardId,
      { isAutoSaved: true },
    );
  };

  private get playgroundSelection() {
    return this.playgroundPanelService.getSelection(this.args.moduleId);
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

  private get card(): CardDef | undefined {
    return this.cardResource?.card;
  }

  private get defaultFormat() {
    return this.args.isFieldDef ? 'embedded' : 'isolated';
  }

  private get format(): Format {
    return (
      this.playgroundPanelService.getSelection(this.args.moduleId)?.format ??
      this.defaultFormat
    );
  }

  private get fieldIndex(): number | undefined {
    let index = this.playgroundPanelService.getSelection(
      this.args.moduleId,
    )?.fieldIndex;
    if (index !== undefined && index >= 0) {
      return index;
    }
    return this.args.isFieldDef ? 0 : undefined;
  }

  private get fieldInstances(): FieldOption[] | undefined {
    if (!this.args.isFieldDef) {
      return undefined;
    }
    let instances = (this.card as Spec | undefined)?.containedExamples;
    if (!instances?.length) {
      return undefined;
    }
    return instances.map((field, i) => {
      let option: FieldOption = {
        index: i,
        displayIndex: i + 1,
        field,
      };
      return option;
    });
  }

  private get field(): FieldDef | undefined {
    if (!this.fieldInstances) {
      return undefined;
    }
    let index = this.fieldIndex!;
    if (index >= this.fieldInstances.length) {
      // display the next available instance if item was deleted
      index = this.fieldInstances.length - 1;
    }
    return this.fieldInstances[index].field;
  }

  private persistSelections = (
    selectedCardId: string,
    selectedFormat = this.format,
    index = this.fieldIndex,
  ) => {
    if (this.newCardJSON) {
      this.newCardJSON = undefined;
    }
    let selection = this.playgroundPanelService.getSelection(
      this.args.moduleId,
    );
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
      this.args.moduleId,
      selectedCardId,
      selectedFormat,
      index,
    );
  };

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

  private get dropdownSelection(): SelectedInstance | undefined {
    if (!this.card) {
      return undefined;
    }
    if (this.args.isFieldDef) {
      return {
        card: this.card,
        fieldIndex: this.fieldIndex,
      };
    }
    return {
      card: this.card,
      fieldIndex: undefined,
    };
  }

  // only closes the dropdown if it's open
  private closeInstanceChooser = () =>
    (
      document.querySelector(
        '[data-playground-instance-chooser][aria-expanded="true"]',
      ) as BoxelSelect | null
    )?.click();

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
    let chosenCard: CardDef | undefined = await chooseCard({
      filter: { type: this.args.codeRef },
    });

    if (chosenCard) {
      this.recentFilesService.addRecentFileUrl(`${chosenCard.id}.json`);
      this.persistSelections(chosenCard.id);
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

  private createNewCard = task(async () => {
    if (this.args.isFieldDef) {
      // for field def, create a new spec card instance
      this.newCardJSON = {
        data: {
          attributes: {
            specType: 'field',
            ref: this.args.codeRef,
            title: this.args.codeRef.name,
          },
          meta: {
            adoptsFrom: specRef,
            realmURL: this.operatorModeStateService.realmURL.href,
          },
        },
      };
    } else {
      this.newCardJSON = {
        data: {
          meta: {
            adoptsFrom: this.args.codeRef,
            realmURL: this.operatorModeStateService.realmURL.href,
          },
        },
      };
    }
    await this.cardResource?.loaded; // TODO: remove await when card-resource is refactored
    if (this.card) {
      this.recentFilesService.addRecentFileUrl(`${this.card.id}.json`);
      if (this.args.isFieldDef) {
        this.createNewField.perform(this.card as Spec);
      } else {
        this.persistSelections(this.card.id, 'edit'); // open new instance in playground in edit format
      }
    }
  });

  private createNewField = task(async (specCard: Spec) => {
    let fieldCard = await loadCard(this.args.codeRef, {
      loader: this.loaderService.loader,
    });
    let examples = specCard.containedExamples;
    examples?.push(new fieldCard());
    let index = examples?.length ? examples.length - 1 : 0;
    this.persistSelections(specCard.id, 'edit', index);
    this.closeInstanceChooser();
  });

  private get canWriteRealm() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  @action
  handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}
