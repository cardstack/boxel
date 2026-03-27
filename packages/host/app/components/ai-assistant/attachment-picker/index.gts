import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import {
  GetCardCollectionContextName,
  cardIdToURL,
  type getCardCollection,
  type Format,
} from '@cardstack/runtime-common';

import type { FileUploadState } from '@cardstack/host/lib/file-upload-state';
import { getPrerenderedSearch } from '@cardstack/host/resources/prerendered-search';

import type RealmServerService from '@cardstack/host/services/realm-server';

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
    chooseLocalFile: () => void | Promise<void>;
    removeFile: (file: FileDef) => void;
    autoAttachedCardTooltipMessage?: string;
    fileUploadStates?: ReadonlyMap<string, FileUploadState>;
    retryFileUpload?: (file: FileDef) => void;
    inputModalities?: string[];
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof AttachedItems,
        | 'items'
        | 'autoAttachedCardIds'
        | 'autoAttachedPrerenderedCards'
        | 'autoAttachedFiles'
        | 'removeCard'
        | 'removeFile'
        | 'chooseCard'
        | 'chooseFile'
        | 'autoAttachedCardTooltipMessage'
        | 'isLoaded'
        | 'fileUploadStates'
        | 'retryFileUpload'
        | 'inputModalities'
      >,
      WithBoundArgs<
        typeof AttachButton,
        'chooseCard' | 'chooseFile' | 'chooseLocalFile'
      >,
    ];
  };
}

export default class AiAssistantAttachmentPicker extends Component<Signature> {
  <template>
    {{yield
      (component
        AttachedItems
        isLoaded=this.isLoaded
        items=this.items
        autoAttachedCardIds=@autoAttachedCardIds
        autoAttachedPrerenderedCards=this.autoAttachedPrerenderedCards
        autoAttachedFiles=@autoAttachedFiles
        removeCard=@removeCard
        removeFile=@removeFile
        chooseCard=@chooseCard
        chooseFile=@chooseFile
        autoAttachedCardTooltipMessage=@autoAttachedCardTooltipMessage
        fileUploadStates=@fileUploadStates
        retryFileUpload=@retryFileUpload
        inputModalities=@inputModalities
      )
      (component
        AttachButton
        chooseCard=@chooseCard
        chooseFile=@chooseFile
        chooseLocalFile=@chooseLocalFile
      )
    }}
  </template>

  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;

  @service declare private realmServer: RealmServerService;

  // Only load manually attached cards through the store (getCardCollection)
  @cached
  private get cardCollection(): ReturnType<getCardCollection> {
    return this.getCardCollection(this, () => this.manuallyAttachedCardIds);
  }

  // Use prerendered search for auto-attached cards to avoid loading full card modules
  private autoAttachedSearchResource = getPrerenderedSearch(
    this,
    getOwner(this)!,
    () => {
      let cardUrls = this.autoAttachedCardIdsArray;
      // Only search realms that contain the requested cards to avoid
      // unnecessary cross-realm federation queries. Resolve card IDs
      // first since they may use prefix form (e.g. @cardstack/catalog/foo).
      let resolvedUrls = cardUrls.map((id) => cardIdToURL(id).href);
      let realms =
        cardUrls.length > 0
          ? this.realmServer.availableRealmURLs.filter((realmUrl) =>
              resolvedUrls.some((url) => url.startsWith(realmUrl)),
            )
          : undefined;
      return {
        query: cardUrls.length > 0 ? {} : undefined,
        format: cardUrls.length > 0 ? ('atom' as Format) : undefined,
        realms,
        cardUrls: resolvedUrls,
        isLive: false,
      };
    },
  );

  private get autoAttachedCardIdsArray() {
    return this.args.autoAttachedCardIds
      ? [...this.args.autoAttachedCardIds]
      : [];
  }

  private get autoAttachedPrerenderedCards() {
    return this.autoAttachedSearchResource.instances;
  }

  private get items() {
    return [...this.cards, ...this.cardErrors, ...this.files];
  }

  private get isLoaded() {
    let manualLoaded =
      this.manuallyAttachedCardIds.length === 0 ||
      this.cardCollection?.isLoaded;
    let autoLoaded =
      this.autoAttachedCardIdsArray.length === 0 ||
      this.autoAttachedSearchResource.hasSearchRun;
    return manualLoaded && autoLoaded;
  }

  private get cards() {
    return this.cardCollection?.cards ?? [];
  }

  private get cardErrors() {
    return this.cardCollection?.cardErrors ?? [];
  }

  // Only manually attached cards go through getCardCollection (which loads full card instances)
  private get manuallyAttachedCardIds() {
    let cardIds = this.args.cardIdsToAttach ?? [];
    cardIds = cardIds.filter(Boolean);
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
