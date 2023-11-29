import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import { RealmPaths, type LocalPath } from '@cardstack/runtime-common/paths';

import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';
import { directory } from '@cardstack/host/resources/directory';

import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Args {
  Args: {
    relativePath: string;
    realmURL: URL;
  };
}

export default class Directory extends Component<Args> {
  <template>
    {{#each this.listing.entries key='path' as |entry|}}
      <div class='level' data-test-directory-level>
        {{#let (concat @relativePath entry.name) as |entryPath|}}
          {{#if (eq entry.kind 'file')}}
            <button
              data-test-file={{entryPath}}
              {{on 'click' (fn this.openFile entryPath)}}
              {{!-- {{scrollIntoViewModifier
                (fileIsSelected entryPath this.operatorModeStateService)
              }} --}}
              class='file
                {{if
                  (fileIsSelected entryPath this.operatorModeStateService)
                  "selected"
                }}'
            >
              {{entry.name}}
            </button>
          {{else}}
            <button
              data-test-directory={{entryPath}}
              {{on 'click' (fn this.toggleDirectory entryPath)}}
              class='directory'
            >
              <DropdownArrowDown
                class={{concat
                  'icon '
                  (if
                    (isOpen entryPath this.operatorModeStateService)
                    'open'
                    'closed'
                  )
                }}
              />{{entry.name}}
            </button>
            {{#if (isOpen entryPath this.operatorModeStateService)}}
              <Directory
                @relativePath='{{@relativePath}}{{entry.name}}'
                @realmURL={{@realmURL}}
              />
            {{/if}}
          {{/if}}
        {{/let}}
      </div>
    {{/each}}
    <style>
      .level {
        --icon-length: 18px;
        --icon-margin: 4px;

        padding-left: 0em;
      }

      .level .level {
        padding-left: 1em;
      }

      .directory,
      .file {
        border-radius: var(--boxel-border-radius-xs);
        background: transparent;
        border: 0;
        padding: var(--boxel-sp-xxxs);
        width: 100%;
        text-align: start;
      }

      .directory:hover,
      .file:hover {
        background-color: var(--boxel-200);
      }

      .file.selected,
      .file:active {
        color: var(--boxel-light);
        background-color: var(--boxel-highlight);
      }

      .directory {
        padding-left: 0;
      }

      .directory :deep(.icon) {
        width: var(--icon-length);
        height: var(--icon-length);
        margin-bottom: -4px;
      }

      .directory :deep(.icon.closed) {
        transform: rotate(-90deg);
      }

      .file {
        padding-left: calc(var(--icon-length) + var(--icon-margin));
      }
    </style>
  </template>

  listing = directory(
    this,
    () => this.args.relativePath,
    () => this.args.realmURL,
  );
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare router: RouterService;

  @action
  openFile(entryPath: LocalPath) {
    let fileUrl = new RealmPaths(this.args.realmURL).fileURL(entryPath);
    this.operatorModeStateService.updateCodePath(fileUrl);
  }

  @action
  toggleDirectory(entryPath: string) {
    this.operatorModeStateService.toggleOpenDir(entryPath);
  }
}

function fileIsSelected(
  localPath: string,
  operatorModeStateService: OperatorModeStateService,
) {
  return operatorModeStateService.codePathRelativeToRealm === localPath;
}

function isOpen(
  path: string,
  operatorModeStateService: OperatorModeStateService,
) {
  let directoryIsPersistedOpen = (
    operatorModeStateService.currentRealmOpenDirs ?? []
  ).find((item) => item.startsWith(path));

  return directoryIsPersistedOpen;
}
