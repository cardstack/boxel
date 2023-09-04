import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { action } from '@ember/object';
import MonacoService from '@cardstack/host/services/monaco-service';
import { htmlSafe } from '@ember/template';
import { type RealmInfo, RealmPaths } from '@cardstack/runtime-common';
import { maybe } from '@cardstack/host/resources/maybe';
import { file } from '@cardstack/host/resources/file';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import CardService from '@cardstack/host/services/card-service';
import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import CardURLBar from '@cardstack/host/components/operator-mode/card-url-bar';
import { on } from '@ember/modifier';
import { registerDestructor } from '@ember/destroyable';
import { TrackedObject } from 'tracked-built-ins';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';

interface Signature {
  Args: {};
}

type ColumnWidths = {
  leftColumn: string;
  codeEditorColumn: string;
  rightColumn: string;
};

export default class CodeMode extends Component<Signature> {
  @service declare monacoService: MonacoService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked realmInfo: RealmInfo | null = null;
  @tracked loadFileError: string | null = null;
  columnDefaultWidths: ColumnWidths = {
    leftColumn: '25%',
    codeEditorColumn: '50%',
    rightColumn: '25%',
  };
  columnWidths: ColumnWidths;
  currentResizeHandler: {
    id: string;
    initialXPosition: number;
    leftEl?: HTMLElement | null;
    rightEl?: HTMLElement | null;
  } | null = null;

  constructor(args: any, owner: any) {
    super(args, owner);
    this.fetchCodeModeRealmInfo.perform();

    this.columnWidths = localStorage.getItem('code-mode-column-widths')
      ? new TrackedObject(
          //@ts-ignore Type 'null' is not assignable to type 'string'
          JSON.parse(localStorage.getItem('code-mode-column-widths')),
        )
      : new TrackedObject(this.columnDefaultWidths);
    document.addEventListener('mouseup', this.onResizeHandlerMouseUp);
    document.addEventListener('mousemove', this.onResizeHandlerMouseMove);

    registerDestructor(this, () => {
      document.removeEventListener('mouseup', this.onResizeHandlerMouseUp);
      document.removeEventListener('mousedown', this.onResizeHandlerMouseMove);
    });
  }

  get backgroundURL() {
    return this.realmInfo?.backgroundURL;
  }

  get backgroundURLStyle() {
    return htmlSafe(`background-image: url(${this.backgroundURL});`);
  }

  @action resetLoadFileError() {
    this.loadFileError = null;
  }

  fetchCodeModeRealmInfo = restartableTask(async () => {
    if (!this.operatorModeStateService.state.codePath) {
      return;
    }

    let realmURL = this.cardService.getRealmURLFor(
      this.operatorModeStateService.state.codePath,
    );
    if (!realmURL) {
      this.realmInfo = null;
    } else {
      this.realmInfo = await this.cardService.getRealmInfoByRealmURL(realmURL);
    }
  });

  openFile = maybe(this, (context) => {
    if (!this.operatorModeStateService.state.codePath) {
      return undefined;
    }

    let realmURL = this.cardService.getRealmURLFor(
      this.operatorModeStateService.state.codePath,
    );
    if (!realmURL) {
      return undefined;
    }

    const realmPaths = new RealmPaths(realmURL);
    const relativePath = realmPaths.local(
      this.operatorModeStateService.state.codePath,
    );
    if (relativePath) {
      return file(context, () => ({
        relativePath,
        realmURL: realmPaths.url,
        onStateChange: (state) => {
          if (state === 'not-found') {
            this.loadFileError = 'File is not found';
          }
        },
      }));
    } else {
      return undefined;
    }
  });

  @action
  onResizeHandlerMouseDown(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    if (this.currentResizeHandler || !buttonId) {
      return;
    }

    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    this.currentResizeHandler = {
      id: buttonId,
      initialXPosition: event.clientX,
      leftEl: parentElement?.previousElementSibling as HTMLElement,
      rightEl: parentElement?.nextElementSibling as HTMLElement,
    };
  }

  @action
  onResizeHandlerMouseUp(_event: MouseEvent) {
    this.currentResizeHandler = null;
  }

  @action
  onResizeHandlerMouseMove(event: MouseEvent) {
    if (
      !this.currentResizeHandler ||
      !this.currentResizeHandler.leftEl ||
      !this.currentResizeHandler.rightEl
    ) {
      return;
    }

    let deltaX = event.clientX - this.currentResizeHandler.initialXPosition;
    let newLeftElWidth = this.currentResizeHandler.leftEl.clientWidth + deltaX;
    let newRightElWidth =
      this.currentResizeHandler.rightEl.clientWidth - deltaX;
    if (newLeftElWidth < 0 && newRightElWidth > 0) {
      newRightElWidth = newRightElWidth + newLeftElWidth;
      newLeftElWidth = 0;
    } else if (newLeftElWidth > 0 && newRightElWidth < 0) {
      newLeftElWidth = newLeftElWidth + newRightElWidth;
      newRightElWidth = 0;
    }

    let leftElMinWidth = this.currentResizeHandler.leftEl
      .computedStyleMap()
      .get('min-width') as { value: number };
    let rightElMinWidth = this.currentResizeHandler.rightEl
      .computedStyleMap()
      .get('min-width') as { value: number };
    if (
      (leftElMinWidth && newLeftElWidth < leftElMinWidth.value) ||
      (rightElMinWidth && newRightElWidth < rightElMinWidth.value)
    ) {
      return;
    }

    this.setColumnWidths({
      leftColumn:
        this.currentResizeHandler.id === 'left-resizer'
          ? `${newLeftElWidth}px`
          : this.columnWidths.leftColumn,
      codeEditorColumn:
        this.currentResizeHandler.id === 'left-resizer'
          ? `${newRightElWidth}px`
          : `${newLeftElWidth}px`,
      rightColumn:
        this.currentResizeHandler.id === 'right-resizer'
          ? `${newRightElWidth}px`
          : this.columnWidths.rightColumn,
    });

    this.currentResizeHandler.initialXPosition = event.clientX;
  }

  @action
  onResizeHandlerDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    let leftEl = parentElement?.previousElementSibling as HTMLElement;
    let rightEl = parentElement?.nextElementSibling as HTMLElement;
    let leftElWidth = leftEl.offsetWidth;
    let rightElWidth = rightEl.offsetWidth;

    if (buttonId === 'left-resizer' && leftElWidth > 0) {
      this.setColumnWidths({
        leftColumn: '0px',
        codeEditorColumn: `${leftElWidth + rightElWidth}px`,
        rightColumn: this.columnWidths.rightColumn,
      });
    } else if (buttonId === 'left-resizer' && leftElWidth <= 0) {
      this.setColumnWidths({
        leftColumn: this.columnDefaultWidths.leftColumn,
        codeEditorColumn: `calc(${this.columnWidths.codeEditorColumn} - ${this.columnDefaultWidths.leftColumn})`,
        rightColumn: this.columnWidths.rightColumn,
      });
    } else if (buttonId === 'right-resizer' && rightElWidth > 0) {
      this.setColumnWidths({
        leftColumn: this.columnWidths.leftColumn,
        codeEditorColumn: `${leftElWidth + rightElWidth}px`,
        rightColumn: '0px',
      });
    } else if (buttonId === 'right-resizer' && rightElWidth <= 0) {
      this.setColumnWidths({
        leftColumn: this.columnWidths.leftColumn,
        codeEditorColumn: `calc(${this.columnWidths.codeEditorColumn} - ${this.columnDefaultWidths.rightColumn})`,
        rightColumn: this.columnDefaultWidths.rightColumn,
      });
    }
  }

  @action
  setColumnWidths(columnWidths: ColumnWidths) {
    this.columnWidths.leftColumn = columnWidths.leftColumn;
    this.columnWidths.codeEditorColumn = columnWidths.codeEditorColumn;
    this.columnWidths.rightColumn = columnWidths.rightColumn;

    localStorage.setItem(
      'code-mode-column-widths',
      JSON.stringify(this.columnWidths),
    );
  }

  <template>
    <div class='code-mode-background' style={{this.backgroundURLStyle}}></div>
    <CardURLBar
      @onEnterPressed={{perform this.fetchCodeModeRealmInfo}}
      @loadFileError={{this.loadFileError}}
      @resetLoadFileError={{this.resetLoadFileError}}
      @realmInfo={{this.realmInfo}}
      class='card-url-bar'
    />
    <div class='code-mode' data-test-code-mode>
      <div class='columns'>
        <div
          class='column'
          style={{cssVar
            code-mode-column-width=this.columnWidths.leftColumn
            code-mode-column-min-width='0px'
          }}
        >
          {{! Move each container and styles to separate component }}
          <div class='inner-container'>
            Inheritance / File Browser
            <section class='inner-container__content'></section>
          </div>
          <aside class='inner-container'>
            <header class='inner-container__header'>
              Recent Files
            </header>
            <section class='inner-container__content'></section>
          </aside>
        </div>
        <div class='separator'>
          <button
            id='left-resizer'
            class='resize-handler'
            {{on 'mousedown' this.onResizeHandlerMouseDown}}
            {{on 'dblclick' this.onResizeHandlerDblClick}}
          />
        </div>
        <div
          class='column'
          style={{cssVar
            code-mode-column-width=this.columnWidths.codeEditorColumn
            code-mode-column-min-width='300px'
          }}
        >
          <div class='inner-container'>
            Code, Open File Status:
            {{! This is to trigger openFile function }}
            {{this.openFile.current.state}}
          </div>
        </div>
        <div class='separator'>
          <button
            id='right-resizer'
            class='resize-handler'
            {{on 'mousedown' this.onResizeHandlerMouseDown}}
            {{on 'dblclick' this.onResizeHandlerDblClick}}
          />
        </div>
        <div
          class='column'
          style={{cssVar
            code-mode-column-width=this.columnWidths.rightColumn
            code-mode-column-min-width='0px'
          }}
        >
          <div class='inner-container'>
            Schema Editor
          </div>
        </div>
      </div>
    </div>

    <style>
      :global(:root) {
        --code-mode-padding-top: calc(
          var(--submode-switcher-trigger-height) + (2 * (var(--boxel-sp)))
        );
        --code-mode-padding-bottom: calc(
          var(--search-sheet-closed-height) + (var(--boxel-sp))
        );
        --code-mode-column-min-width: calc(
          var(--operator-mode-min-width) - 2 * var(--boxel-sp)
        );
        --code-mode-column-width: var(--code-mode-column-min-width);
      }

      .code-mode {
        height: 100%;
        max-height: 100vh;
        left: 0;
        right: 0;
        z-index: 1;
        padding: var(--code-mode-padding-top) var(--boxel-sp)
          var(--code-mode-padding-bottom);
        overflow: auto;
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
        flex-shrink: 0;
        height: 100%;
      }
      .column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        overflow: hidden;
        width: var(--code-mode-column-width);
        min-width: var(--code-mode-column-min-width);
      }
      .column:nth-child(2) {
        flex: 2;
      }
      .column:last-child {
        flex: 1.2;
      }
      .column:first-child > *:first-child {
        max-height: 50%;
        background-color: var(--boxel-200);
      }
      .column:first-child > *:last-child {
        max-height: calc(50% - var(--boxel-sp));
        background-color: var(--boxel-200);
      }

      .inner-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
      }
      .inner-container__header {
        padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .inner-container__content {
        padding: 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        overflow-y: auto;
      }
      .card-url-bar {
        position: absolute;
        top: var(--boxel-sp);
        left: calc(var(--submode-switcher-width) + (var(--boxel-sp) * 2));

        --card-url-bar-width: calc(
          100% - (var(--submode-switcher-width) + (var(--boxel-sp) * 3))
        );
        height: var(--submode-switcher-height);

        z-index: 2;
      }

      .separator {
        display: flex;
        align-items: center;

        padding: var(--boxel-sp-xxxs);
      }
      .resize-handler {
        cursor: col-resize;

        height: 100px;
        width: 5px;
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-200);
      }
    </style>
  </template>
}
