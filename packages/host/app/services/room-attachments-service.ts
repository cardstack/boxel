import Service, { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  type Submode,
  Submodes,
} from '@cardstack/host/components/submode-switcher';
import { type StackItem } from '@cardstack/host/lib/stack-item';

export default class RoomAttachmentsService extends Service {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

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

  get autoAttachedCards(): CardDef[] | undefined {
    if (this.submode === Submodes.Code) {
      return undefined;
    }
    return this.operatorModeStateService
      .topMostStackItems()
      .filter((stackItem: StackItem) => stackItem)
      .map((stackItem: StackItem) => stackItem.card);
  }

  get openCardIds(): string[] | undefined {
    return this.autoAttachedCards?.map((c) => c.id);
  }
}
