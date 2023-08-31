import Controller from '@ember/controller';
import { withPreventDefault } from '../helpers/with-prevent-default';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import stringify from 'safe-stable-stringify';
import { ComponentLike } from '@glint/template';
import { Model } from '@cardstack/host/routes/card';
import { registerDestructor } from '@ember/destroyable';
import type { Query } from '@cardstack/runtime-common/query';
import { getSearchResults, type Search } from '../resources/search';
import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';
import type CodeService from '@cardstack/host/services/code-service';
import { Submode } from '@cardstack/host/components/submode-switcher';
import type CodeController from '@cardstack/host/controllers/code';

export default class CardController extends Controller {
  queryParams = [
    'operatorModeState',
    'operatorModeEnabled',
    'openFile',
    'openDirs',
  ];

  isolatedCardComponent: ComponentLike | undefined;
  withPreventDefault = withPreventDefault;

  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare codeService: CodeService;

  @tracked operatorModeEnabled = false;
  @tracked model: Model | undefined;
  @tracked operatorModeState: string | null = null;

  @tracked openFile: string | undefined;
  @tracked openDirs: string | undefined;

  constructor(args: any) {
    super(args);
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
    });
  }

  get codeParams() {
    return new OpenFiles(this);
  }

  openPath(newPath: string | undefined) {
    this.openFile = newPath;

    if (newPath) {
      const existingIndex = this.codeService.recentFiles.indexOf(newPath);

      if (existingIndex > -1) {
        this.codeService.recentFiles.splice(existingIndex, 1);
      }

      this.codeService.recentFiles.unshift(newPath);
      this.codeService.persistRecentFiles();
    }
  }

  getCards(query: Query, realms?: string[]): Search {
    return getSearchResults(
      this,
      () => query,
      realms ? () => realms : undefined,
    );
  }

  @action
  toggleOperatorMode() {
    this.operatorModeEnabled = !this.operatorModeEnabled;

    if (this.operatorModeEnabled) {
      // When entering operator mode, put the current card on the stack
      this.operatorModeState = stringify({
        stacks: [
          [
            {
              id: this.model?.id,
              format: 'isolated',
            },
          ],
        ],
        submode: Submode.Interact,
      } as OperatorModeSerializedState)!;
    } else {
      this.operatorModeState = null;
    }
  }

  @action
  closeOperatorMode() {
    this.operatorModeEnabled = false;
  }
}

export class OpenFiles {
  constructor(private controller: CardController | CodeController) {}
  get path(): string | undefined {
    return this.controller.openFile;
  }
  set path(newPath: string | undefined) {
    this.controller.openPath(newPath);
  }
  get openDirs(): string[] {
    return this.controller.openDirs ? this.controller.openDirs.split(',') : [];
  }
  toggleOpenDir(entryPath: string): void {
    let dirs = this.openDirs.slice();
    for (let i = 0; i < dirs.length; i++) {
      if (dirs[i].startsWith(entryPath)) {
        let localParts = entryPath.split('/').filter((p) => p.trim() != '');
        localParts.pop();
        if (localParts.length) {
          dirs[i] = localParts.join('/') + '/';
        } else {
          dirs.splice(i, 1);
        }
        this.controller.openDirs = dirs.join(',');
        return;
      } else if (entryPath.startsWith(dirs[i])) {
        dirs[i] = entryPath;
        this.controller.openDirs = dirs.join(',');
        return;
      }
    }
    this.controller.openDirs = [...dirs, entryPath].join(',');
  }
}
