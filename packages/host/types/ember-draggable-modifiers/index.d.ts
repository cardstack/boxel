declare module 'ember-draggable-modifiers/modifiers/drop-target' {
  import type { ModifierLike } from '@glint/template';

  interface DragAndDropPayload {
    event: unknown;
    source: {
      data: any;
      group?: string;
    };
    target: {
      data?: any;
      edge?: 'top' | 'bottom' | 'left' | 'right' | null;
      group?: string;
      tree?: string;
    };
  }

  interface DropTargetSignature {
    Args: {
      Named: {
        accepts?: string[];
        allowDropOnChildren?: boolean;
        allowDropOnItself?: boolean;
        allowedEdges?: Array<'top' | 'bottom' | 'left' | 'right'>;
        canDrop?: (payload: DragAndDropPayload, canDrop: boolean) => boolean;
        data?: unknown;
        direction?: 'horizontal' | 'vertical';
        disabled?: boolean;
        group?: string;
        isOnTargetClass?: string;
        onDragEnter?: (payload: DragAndDropPayload) => void;
        onDragLeave?: (payload: DragAndDropPayload) => void;
        onDrop?: (payload: DragAndDropPayload) => void;
        onHover?: (payload: DragAndDropPayload) => void;
      };
      Positional: [];
    };
    Element: HTMLElement;
  }

  const DropTargetModifier: ModifierLike<DropTargetSignature>;
  export default DropTargetModifier;
}

declare module 'ember-draggable-modifiers/modifiers/sortable-item' {
  import type { ModifierLike } from '@glint/template';

  interface DragAndDropPayload {
    event: unknown;
    source: {
      data: any;
      group?: string;
    };
    target: {
      data?: any;
      edge?: 'top' | 'bottom' | 'left' | 'right' | null;
      group?: string;
      tree?: string;
    };
  }

  interface SortableItemSignature {
    Args: {
      Named: {
        accepts?: string[];
        allowDropOnChildren?: boolean;
        allowDropOnItself?: boolean;
        allowedEdges?: Array<'top' | 'bottom' | 'left' | 'right'>;
        canDrop?: (payload: DragAndDropPayload, canDrop: boolean) => boolean;
        data?: unknown;
        direction?: 'horizontal' | 'vertical';
        disabled?: boolean;
        disabledDrag?: boolean;
        disabledDrop?: boolean;
        dragHandleElement?: string;
        group?: string;
        isDraggingClass?: string;
        isOnTargetClass?: string;
        onDragEnd?: (payload: DragAndDropPayload) => void;
        onDragEnter?: (payload: DragAndDropPayload) => void;
        onDragLeave?: (payload: DragAndDropPayload) => void;
        onDragStart?: (payload: DragAndDropPayload) => void;
        onDrop?: (payload: DragAndDropPayload) => void;
        onHover?: (payload: DragAndDropPayload) => void;
      };
      Positional: [];
    };
    Element: HTMLElement;
  }

  const SortableItemModifier: ModifierLike<SortableItemSignature>;
  export default SortableItemModifier;
}

declare module 'ember-draggable-modifiers/utils/array' {
  export function insertAt<T>(arr: T[], index: number, item: T): T[];
  export function removeAt<T>(arr: T[], index: number): T[];
  export function insertBefore<T>(arr: T[], targetItem: T, item: T): T[];
  export function insertAfter<T>(arr: T[], targetItem: T, item: T): T[];
  export function removeItem<T>(arr: T[], item: T): T[];
}
