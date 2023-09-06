import Component from '@glimmer/component';
import { service } from '@ember/service';
import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory } from '@cardstack/host/resources/directory';
import { concat } from '@ember/helper';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

interface Args {
  Args: {
    relativePath: string;
    realmURL: string;
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
              {{svgJar
                'dropdown-arrow-down'
                class=(concat
                  'icon '
                  (if
                    (isOpen entryPath this.operatorModeStateService)
                    'open'
                    'closed'
                  )
                )
              }}{{entry.name}}
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
        margin-bottom: 2px;
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
        margin-right: var(--icon-margin);
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
  openFile(entryPath: string) {
    let fileUrl = new URL(this.cardService.defaultURL + entryPath);
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
  return operatorModeStateService.state.codePath?.pathname.endsWith(localPath);
}

function isOpen(
  path: string,
  operatorModeStateService: OperatorModeStateService,
) {
  return (operatorModeStateService.state.openDirs ?? []).find((item) =>
    item.startsWith(path),
  );
}
