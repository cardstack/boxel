import Service, { service } from '@ember/service';

import {
  type ResolvedCodeRef,
  internalKeyFor,
} from '@cardstack/runtime-common';

import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import { type StackItem } from '@cardstack/host/lib/stack-item';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type StoreService from '@cardstack/host/services/store';

export default class RoomAttachmentsService extends Service {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private playgroundPanelService: PlaygroundPanelService;
  @service declare private store: StoreService;

  private get submode(): Submode {
    return this.operatorModeStateService.state.submode;
  }

  get openFileURL(): string | undefined {
    if (this.submode === Submodes.Code) {
      return this.operatorModeStateService.state.codePath?.href;
    }
    return undefined;
  }

  getOpenCardIds(selectedCardRef?: ResolvedCodeRef): string[] | undefined {
    // selectedCardRef is only needed for determining open playground card id in code submode
    if (this.submode === Submodes.Code && selectedCardRef) {
      let moduleId = internalKeyFor(selectedCardRef, undefined);
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
