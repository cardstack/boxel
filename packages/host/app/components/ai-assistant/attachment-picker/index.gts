import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { TrackedSet } from 'tracked-built-ins';

import {
  GetCardCollectionContextName,
  type getCardCollection,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import AttachButton from './attach-button';
import AttachedItems from './attached-items';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    autoAttachedCardIds?: TrackedSet<string>;
    cardIdsToAttach: string[] | undefined;
    autoAttachedFile?: FileDef;
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
        | 'autoAttachedFile'
        | 'removeCard'
        | 'removeFile'
        | 'autoAttachedCardTooltipMessage'
        | 'isLoaded'
      >,
      WithBoundArgs<
        typeof AttachButton,
        'files' | 'cards' | 'chooseCard' | 'chooseFile'
      >,
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
        autoAttachedFile=@autoAttachedFile
        removeCard=@removeCard
        removeFile=@removeFile
        autoAttachedCardTooltipMessage=@autoAttachedCardTooltipMessage
      )
      (component
        AttachButton
        files=this.files
        cards=this.cards
        chooseCard=@chooseCard
        chooseFile=@chooseFile
      )
    }}
  </template>

  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;

  @tracked private cardCollection: ReturnType<getCardCollection> | undefined;

  private makeCardResources = () => {
    this.cardCollection = this.getCardCollection(this, () => this.cardIds);
  };

  private get items() {
    return [...this.cards, ...this.files];
  }

  private get isLoaded() {
    return this.cardCollection?.isLoaded;
  }

  private get cards() {
    return this.cardCollection?.cards ?? [];
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

    if (this.args.autoAttachedFile) {
      files = [...new Set([this.args.autoAttachedFile, ...files])];
    }

    return files;
  }
}
