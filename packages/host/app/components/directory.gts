import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { directory } from '../resources/directory';
import { concat } from '@ember/helper';

interface Args {
  Args: {
    openDirs: string[];
    realmURL: string;
    relativePath: string;
    openFile: string | undefined;
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
              class='file {{if (eq entryPath @openFile) "selected"}}'
            >
              {{entry.name}}
            </div>
          {{else}}
            <div
              data-test-directory={{entryPath}}
              role='button'
              {{on 'click' (fn this.toggleDirectory entryPath)}}
              class='directory
                {{if (isSelected entryPath @openFile) "selected"}}'
            >
              {{entry.name}}
            </div>
            {{#if (isOpen entryPath @openDirs)}}
              <Directory
                @openFile={{@openFile}}
                @openDirs={{@openDirs}}
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
    () => this.args.realmURL
  );
  @service declare router: RouterService;

  @action
  openFile(entryPath: string) {
    this.router.transitionTo({ queryParams: { path: entryPath } });
  }

  @action
  toggleDirectory(entryPath: string) {
    let openDirs = editOpenDirsQuery(entryPath, this.args.openDirs);
    this.router.transitionTo({
      queryParams: {
        openDirs: openDirs.length ? openDirs.join(',') : undefined,
      },
    });
  }
}

function editOpenDirsQuery(entryPath: string, openDirs: string[]): string[] {
  let dirs = openDirs.slice();
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].startsWith(entryPath)) {
      let localParts = entryPath.split('/').filter((p) => p.trim() != '');
      localParts.pop();
      if (localParts.length) {
        dirs[i] = localParts.join('/') + '/';
      } else {
        dirs.splice(i, 1);
      }
      return dirs;
    } else if (entryPath.startsWith(dirs[i])) {
      dirs[i] = entryPath;
      return dirs;
    }
  }
  return [...dirs, entryPath];
}

function isSelected(localPath: string, openFile: string | undefined) {
  return openFile?.startsWith(localPath);
}

function isOpen(path: string, openDirs: string[]) {
  return openDirs.find((item) => item.startsWith(path));
}
