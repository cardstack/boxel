import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  GetCardCollectionContextName,
  type getCardCollection,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import AttachButton from './attach-button';
import AttachedItems from './attached-items';

import type { WithBoundArgs } from '@glint/template';
import type { TrackedSet } from 'tracked-built-ins';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    autoAttachedCardIds?: TrackedSet<string>;
    cardIdsToAttach: string[] | undefined;
    autoAttachedFiles?: FileDef[];
    filesToAttach: FileDef[] | undefined;
    chooseCard: (cardId: string) => void;
    removeCard: (cardId: string) => void;
    chooseFile: (file: FileDef) => void;
    removeFile: (file: FileDef) => void;
    autoAttachedCardTooltipMessage?: string;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof AttachedItems,
        | 'items'
        | 'autoAttachedCardIds'
        | 'autoAttachedFiles'
        | 'removeCard'
        | 'removeFile'
        | 'chooseCard'
        | 'chooseFile'
        | 'autoAttachedCardTooltipMessage'
        | 'isLoaded'
      >,
      WithBoundArgs<typeof AttachButton, 'chooseCard' | 'chooseFile'>,
    ];
  };
}

export default class AiAssistantAttachmentPicker extends Component<Signature> {
  <template>
    {{consumeContext this.makeCardResources}}
    {{yield
      (component
        AttachedItems
        isLoaded=this.isLoaded
        items=this.items
        autoAttachedCardIds=@autoAttachedCardIds
        autoAttachedFiles=@autoAttachedFiles
        removeCard=@removeCard
        removeFile=@removeFile
        chooseCard=@chooseCard
        chooseFile=@chooseFile
        autoAttachedCardTooltipMessage=@autoAttachedCardTooltipMessage
      )
      (component AttachButton chooseCard=@chooseCard chooseFile=@chooseFile)
    }}
  </template>

  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;

  @tracked private cardCollection: ReturnType<getCardCollection> | undefined;

  private makeCardResources = () => {
    this.cardCollection = this.getCardCollection(this, () => this.cardIds);
  };

  private get items() {
    return [...this.cards, ...this.cardErrors, ...this.files];
  }

  private get isLoaded() {
    return this.cardCollection?.isLoaded;
  }

  private get cards() {
    return this.cardCollection?.cards ?? [];
  }

  private get cardErrors() {
    return this.cardCollection?.cardErrors ?? [];
  }

  private get cardIds() {
    let cardIds = this.args.cardIdsToAttach ?? [];

    if (this.args.autoAttachedCardIds) {
      cardIds = [...new Set([...this.args.autoAttachedCardIds, ...cardIds])];
    }

    cardIds = cardIds.filter(Boolean); // Dont show new unsaved cards
    return cardIds;
  }

  private get files() {
    let files = this.args.filesToAttach ?? [];

    let autoAttachedFiles = this.args.autoAttachedFiles ?? [];

    if (autoAttachedFiles.length === 0) {
      return files;
    }

    let autoFilesToPrepend = autoAttachedFiles.filter(
      (file) => !files.some((item) => item.sourceUrl === file.sourceUrl),
    );

    if (autoFilesToPrepend.length === 0) {
      return files;
    }

    return [...autoFilesToPrepend, ...files];
  }
}
