import Component from '@glimmer/component';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { TrackedMap } from 'tracked-built-ins';

export type PanelContext = {
  width: string;
  defaultWidth: string;
  minWidth?: string;
};

export type PanelGroupApi = {
  registerPanel: (context: PanelContext) => number;
  panelContext: (panelId: number) => PanelContext | undefined;
  isLastPanel: (panelId: number) => boolean;
  onResizeHandlerMouseDown: (event: MouseEvent) => void;
  onResizeHandlerDblClick: (event: MouseEvent) => void;
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onListPanelContextChange?: (listPanelContext: PanelContext[]) => void;
  };
  Blocks: {
    default: [{ api: PanelGroupApi }];
  };
}

export default class ResizablePanelGroup extends Component<Signature> {
  <template>
    <div class='boxel-panel-group' ...attributes>
      {{yield
        (hash
          api=(hash
            registerPanel=this.registerPanel
            panelContext=this.panelContext
            isLastPanel=this.isLastPanel
            onResizeHandlerMouseDown=this.onResizeHandlerMouseDown
            onResizeHandlerDblClick=this.onResizeHandlerDblClick
          )
        )
      }}
    </div>
    <style>
      .boxel-panel-group {
        display: flex;
        flex-direction: row;
        flex-shrink: 0;
        height: 100%;
      }
    </style>
  </template>

  constructor(args: any, owner: any) {
    super(args, owner);

    document.addEventListener('mouseup', this.onResizeHandlerMouseUp);
    document.addEventListener('mousemove', this.onResizeHandlerMouseMove);

    registerDestructor(this, () => {
      document.removeEventListener('mouseup', this.onResizeHandlerMouseUp);
      document.removeEventListener('mousedown', this.onResizeHandlerMouseMove);
    });
  }

  listPanelContext = new TrackedMap<number, PanelContext>();
  currentResizeHandler: {
    id: string;
    initialXPosition: number;
    leftEl?: HTMLElement | null;
    rightEl?: HTMLElement | null;
  } | null = null;

  @action
  registerPanel(context: PanelContext) {
    let id = Number(this.listPanelContext.size + 1);
    this.listPanelContext.set(id, context);

    return id;
  }

  @action
  panelContext(panelId: number) {
    return this.listPanelContext.get(panelId);
  }

  @action
  isLastPanel(panelId: number) {
    return panelId === this.listPanelContext.size;
  }

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

    let leftElId = Number(this.currentResizeHandler.leftEl?.id);
    let rightElId = Number(this.currentResizeHandler.rightEl?.id);
    this.setLeftAndRighPanelContext(
      leftElId,
      rightElId,
      `${newLeftElWidth}px`,
      `${newRightElWidth}px`,
    );

    this.currentResizeHandler.initialXPosition = event.clientX;
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum width of the panel will be disregarded.
  @action
  onResizeHandlerDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    let leftEl = parentElement?.previousElementSibling as HTMLElement;
    let rightEl = parentElement?.nextElementSibling as HTMLElement;

    let leftElWidth = leftEl.offsetWidth;
    let rightElWidth = rightEl.offsetWidth;
    let leftElContext = this.listPanelContext.get(Number(leftEl.id));
    let rightElContext = this.listPanelContext.get(Number(rightEl.id));

    if (buttonId.includes('1') && leftElWidth > 0) {
      this.setLeftAndRighPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        '0px',
        `${leftElWidth + rightElWidth}px`,
        `0px`,
      );
    } else if (buttonId.includes('1') && leftElWidth <= 0 && leftElContext) {
      this.setLeftAndRighPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        leftElContext.defaultWidth,
        `calc(${rightElWidth}px - ${leftElContext.defaultWidth})`,
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      rightElWidth > 0
    ) {
      this.setLeftAndRighPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        `${leftElWidth + rightElWidth}px`,
        '0px',
        undefined,
        '0px',
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      rightElWidth <= 0 &&
      rightElContext
    ) {
      this.setLeftAndRighPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        `calc(${leftElWidth}px - ${rightElContext.defaultWidth})`,
        rightElContext.defaultWidth,
      );
    }
  }

  @action
  setLeftAndRighPanelContext(
    leftElId: number,
    rightElId: number,
    newLeftElWidth: string,
    newRightElWidth: string,
    newLeftElMinWidth?: string,
    newRightElMinWidth?: string,
  ) {
    let leftPanelContext = this.listPanelContext.get(leftElId);
    if (leftPanelContext) {
      this.listPanelContext.set(leftElId, {
        ...leftPanelContext,
        width: newLeftElWidth,
        minWidth: newLeftElMinWidth,
      });
    }

    let rightPanelContext = this.listPanelContext.get(rightElId);
    if (rightPanelContext) {
      this.listPanelContext.set(rightElId, {
        ...rightPanelContext,
        width: newRightElWidth,
        minWidth: newRightElMinWidth,
      });
    }

    this.args.onListPanelContextChange?.(
      Array.from(this.listPanelContext, ([_name, value]) => value),
    );
  }
}
