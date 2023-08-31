import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory } from '@cardstack/host/resources/directory';
import { concat } from '@ember/helper';
import type { OpenFiles } from '@cardstack/host/controllers/card';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

interface Args {
  Args: {
    openFiles: OpenFiles;
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
              role='button'
              {{on 'click' (fn this.openFile entryPath)}}
              class='file {{if (eq entryPath @openFiles.path) "selected"}}'
            >
              {{entry.name}}
            </button>
          {{else}}
            <button
              data-test-directory={{entryPath}}
              role='button'
              {{on 'click' (fn this.toggleDirectory entryPath)}}
              class='directory
                {{if (isSelected entryPath @openFiles.path) "selected"}}'
            >
              {{svgJar
                'dropdown-arrow-down'
                class=(concat
                  'icon '
                  (if (isOpen entryPath @openFiles.openDirs) 'open' 'closed')
                )
              }}{{entry.name}}
            </button>
            {{#if (isOpen entryPath @openFiles.openDirs)}}
              <Directory
                @openFiles={{@openFiles}}
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
  @service declare router: RouterService;

  @action
  openFile(entryPath: string) {
    this.args.openFiles.path = entryPath;
  }

  @action
  toggleDirectory(entryPath: string) {
    this.args.openFiles.toggleOpenDir(entryPath);
  }
}

function isSelected(localPath: string, openFile: string | undefined) {
  return openFile?.startsWith(localPath);
}

function isOpen(path: string, openDirs: string[]) {
  return openDirs.find((item) => item.startsWith(path));
}
