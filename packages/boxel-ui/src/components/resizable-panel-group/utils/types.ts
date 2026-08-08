import type { SafeString } from '@ember/template';

export type GetPanelStyle = () => SafeString;

export type DragState = {
  dragHandleId: string;
  dragHandleRect: DOMRect;
  initialCursorPosition: number;
  initialLayout: number[];
};

export type ResizeHandleState = 'drag' | 'hover' | 'inactive';
export type ResizeEvent = PointerEvent | MouseEvent;
export type ResizeHandler = (event: ResizeEvent) => void;

export type Orientation = 'horizontal' | 'vertical';

export type ResizablePanelConstraints = {
  collapsible?: boolean | undefined;
  defaultSize?: number | undefined;
  maxSize?: number | undefined;
  minSize?: number | undefined;
};
