import Service, { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type StoreService from '@cardstack/host/services/store';

import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import { type StackItem } from '@cardstack/host/lib/stack-item';

export default class RoomAttachmentsService extends Service {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private playgroundPanelService: PlaygroundPanelService;
  @service declare private store: StoreService;

  private get submode(): Submode {
    return this.operatorModeStateService.state.submode;
  }

  get autoAttachedFileURL(): string | undefined {
    if (this.submode !== Submodes.Code) {
      return undefined;
    }
    return this.operatorModeStateService.state.codePath?.href;
  }

  get autoAttachedFile() {
    let fileURL = this.autoAttachedFileURL;
    if (!fileURL) {
      return undefined;
    }

    return this.matrixService.fileAPI.createFileDef({
      sourceUrl: fileURL,
      name: fileURL.split('/').pop(),
    });
  }

  // moduleId is only needed for determining open playground card id in code submode
  getOpenCardIds(moduleId?: string): string[] | undefined {
    if (this.submode === Submodes.Code) {
      if (!moduleId) {
        return;
      }
      return [this.playgroundPanelService.getSelection(moduleId)?.cardId];
    }

    if (this.submode === Submodes.Interact) {
      return this.operatorModeStateService
        .topMostStackItems()
        .filter((stackItem: StackItem) => stackItem)
        .map((stackItem: StackItem) => stackItem.url)
        .filter(Boolean) as string[];
    }

    return;
  }
}
