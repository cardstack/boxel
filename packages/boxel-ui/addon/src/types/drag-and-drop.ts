import Modifier from 'ember-modifier';

export interface DndDraggableItemSignature {
  Args: {
    Named: {
      data?: any;
      disabled?: boolean;
      dragHandleElement?: string;
      group?: string;
      isDraggingClass?: string;
      onDragEnd?: (event: DragEvent) => void;
      onDragStart?: (event: DragEvent) => void;
      onDrop?: (event: { destination: unknown; source: unknown }) => void;
    };
    Positional: [];
  };
}

export interface DndDropTargetSignature {
  Args: {
    Named: {
      accepts?: string[];
      allowDropOnChildren?: boolean;
      allowDropOnItself?: boolean;
      allowedEdges?: ('top' | 'bottom' | 'left' | 'right')[];
      canDrop?: (event: DragEvent) => boolean;
      data?: any;
      direction?: 'horizontal' | 'vertical';
      disabled?: boolean;
      group?: string;
      isOnTargetClass?: string;
      onDragEnter?: (event: DragEvent) => void;
      onDragLeave?: (event: DragEvent) => void;
      onDrop?: (event: DragEvent, item: any) => void;
      onHover?: (event: DragEvent) => void;
    };
    Positional: [];
  };
}

export interface DndSortableItemSignature {
  Args: {
    Named: {
      accepts?: string[];
      allowDropOnChildren?: boolean;
      allowDropOnItself?: boolean;
      allowedEdges?: ('top' | 'bottom' | 'left' | 'right')[];
      canDrop?: (event: DragEvent) => boolean;
      data?: any;
      direction?: 'horizontal' | 'vertical';
      disabled?: boolean;
      disabledDrag?: boolean;
      disabledDrop?: boolean;
      dragHandleElement?: string;
      group?: string;
      isDraggingClass?: string;
      isOnTargetClass?: string;
      onDragEnd?: (event: DragEvent) => void;
      onDragEnter?: (event: DragEvent) => void;
      onDragLeave?: (event: DragEvent) => void;
      onDragStart?: (event: DragEvent) => void;
      onDrop?: (event: DragEvent, item: any) => void;
      onHover?: (event: DragEvent) => void;
    };
    Positional: [];
  };
}

export type DndDraggableItemModifier = Modifier<DndDraggableItemSignature>;
export type DndDropTargetModifier = Modifier<DndDropTargetSignature>;
export type DndSortableItemModifier = Modifier<DndSortableItemSignature>;
