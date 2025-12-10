import type Owner from '@ember/owner';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import type { LocalPath } from '@cardstack/runtime-common';

import Directory from './directory';

interface Signature {
  Args: {
    realmURL: URL;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => Promise<void>;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
  };
}

export default class FileTree extends Component<Signature> {
  <template>
    <nav>
      <Directory
        @relativePath=''
        @realmURL={{@realmURL}}
        @selectedFile={{@selectedFile}}
        @openDirs={{@openDirs}}
        @onFileSelected={{@onFileSelected}}
        @onDirectorySelected={{@onDirectorySelected}}
        @scrollPositionKey={{@scrollPositionKey}}
      />
      {{#if this.showMask}}
        <div class='mask' data-test-file-tree-mask></div>
      {{/if}}
    </nav>

    <style scoped>
      .mask {
        position: absolute;
        top: 0;
        left: 0;
        background-color: white;
        height: 100%;
        width: 100%;
      }
      nav {
        position: relative;
      }
    </style>
  </template>

  @tracked private showMask = true;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.hideMask.perform();
  }

  private hideMask = restartableTask(async () => {
    // fine tuned to coincide with debounce in RestoreScrollPosition modifier
    await timeout(300);
    this.showMask = false;
  });
}
