import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory } from '@cardstack/host/resources/directory';
import { concat } from '@ember/helper';
import { OpenFiles } from '@cardstack/host/controllers/code';

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
            <div
              data-test-file={{entryPath}}
              role='button'
              {{on 'click' (fn this.openFile entryPath)}}
              class='file {{if (eq entryPath @openFiles.path) "selected"}}'
            >
              {{entry.name}}
            </div>
          {{else}}
            <div
              data-test-directory={{entryPath}}
              role='button'
              {{on 'click' (fn this.toggleDirectory entryPath)}}
              class='directory
                {{if (isSelected entryPath @openFiles.path) "selected"}}'
            >
              {{entry.name}}
            </div>
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
        padding-left: 0em;
      }

      .level .level {
        padding-left: 1em;
      }

      .file:hover {
        color: var(--boxel-highlight);
        cursor: pointer;
      }

      .directory.selected,
      .file.selected,
      .file:active {
        color: var(--boxel-highlight);
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
