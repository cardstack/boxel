import Component from '@glimmer/component';
import { service } from '@ember/service';
import MonacoService from '@cardstack/host/services/monaco-service';
import { htmlSafe } from '@ember/template';
import { FileResource } from '@cardstack/host/resources/file';
import { type RealmInfo } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    openFile: { current: FileResource | undefined };
    realmInfo: RealmInfo | null;
  };
}

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;

  constructor(args: any, owner: any) {
    super(args, owner);
  }

  get backgroundURL() {
    return this.args.realmInfo?.backgroundURL;
  }

  get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>

    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div class='column'>File tree</div>
        <div class='column'>Code, Open File Status:
          {{! This is to trigger openFile function }}
          {{@openFile.current.state}}</div>
        <div class='column'>Schema editor</div>
      </div>
    </div>

    <style>
      .code-mode {
        position: fixed;
        height: 100%;
        left: 0;
        right: 0;
        z-index: 1;
      }

      .code-mode-background {
        position: fixed;
        left: 0;
        right: 0;
        display: block;
        width: 100%;
        height: 100%;
        filter: blur(15px);
        background-size: cover;
      }

      .columns {
        display: flex;
        flex-direction: row;
        height: calc(100% - var(--search-sheet-closed-height) - 90px);
        margin-top: 70px;
        padding: var(--boxel-sp);
      }

      .column {
        flex: 1;
        border: 1px solid black;
        margin-right: var(--boxel-sp-lg);

        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
