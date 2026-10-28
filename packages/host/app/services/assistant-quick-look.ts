import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { Submodes } from '../components/submode-switcher';

import type NetworkService from './network';
import type OperatorModeStateService from './operator-mode-state-service';

export interface QuickLookRequest {
  /** a card instance, or a file in a realm */
  kind: 'card' | 'file';
  /** the card's id, or the file's URL */
  id: string;
  /**
   * The box it was opened from, as a stable per-pill string
   * (`ql:<owner>:<id>`): the place the sheet comes out of and goes back
   * to. Pills publish it with `{{beacon}}`; nothing here measures it.
   */
  sourceKey: string;
  /** the pill or embed that opened it: focus returns there on close, and
   * only the assistant panel that holds it shows the sheet */
  trigger?: HTMLElement;
}

/**
 * Quick Look in the assistant: a card or a file the transcript shows, looked
 * at over the transcript before it is opened properly. Opening and closing
 * are plain state changes; the sheet renders, or stops rendering, on the
 * same pass, and its motion is the assistant panel's Choreo region reacting
 * to that (ADR 007 §1.1, §1.2). Nothing here knows about animation.
 */
export default class AssistantQuickLookService extends Service {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private network: NetworkService;

  @tracked current: QuickLookRequest | null = null;

  open = (request: QuickLookRequest) => {
    this.current = request;
  };

  close = () => {
    this.current = null;
  };

  /** Open it properly, and put the Quick Look away. A card opens on the
   * rightmost stack, beside the panel (in code mode, at its source); a file
   * opens in code mode. */
  openProperly = (request: QuickLookRequest) => {
    this.close();
    if (request.kind === 'file') {
      this.openFileInCode(request.id);
      return;
    }
    let om = this.operatorModeStateService;
    if (om.state?.submode === Submodes.Code) {
      om.updateCodePath(new URL(request.id));
      return;
    }
    let stackIndex = Math.max(om.numberOfStacks() - 1, 0);
    om.addItemToStack(om.createStackItem(request.id, stackIndex, 'isolated'));
  };

  /** a card's instance JSON, in code mode */
  openSource = (request: QuickLookRequest) => {
    this.close();
    let id = request.id;
    this.openFileInCode(
      request.kind === 'card' && !id.endsWith('.json') ? `${id}.json` : id,
    );
  };

  canOpenInCode = (request: QuickLookRequest) =>
    this.operatorModeStateService.codeSubmodeOffered(request.id);

  // Opens a realm file in code mode; the changed-files list under a turn
  // opens its files the same way.
  openFileInCode(url: string) {
    let om = this.operatorModeStateService;
    if (om.workspaceChooserOpened) {
      om.closeWorkspaceChooser();
    }
    if (
      om.state.submode === Submodes.Code &&
      this.network.virtualNetwork.unresolveURL(url) === om.state.codePath
    ) {
      return;
    }
    om.updateSubmode(Submodes.Code);
    om.updateCodePath(new URL(url));
  }
}

declare module '@ember/service' {
  interface Registry {
    'assistant-quick-look': AssistantQuickLookService;
  }
}
