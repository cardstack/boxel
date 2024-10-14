declare module 'ember-draggable-modifiers/modifiers/sortable-item' {
  import Modifier from 'ember-modifier';

  export default class DndSortableItemModifier extends Modifier<{
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
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/draggable-item' {
  import Modifier from 'ember-modifier';

  export default class DndDraggableItemModifier extends Modifier<{
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
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/drop-target' {
  import Modifier from 'ember-modifier';

  export default class DndDropTargetModifier extends Modifier<{
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
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/draggable-item-handle' {
  import Modifier from 'ember-modifier';

  export default class DndDraggableItemHandleModifier extends Modifier<{
    Args: {
      Named: {
        disabled?: boolean;
      };
      Positional: [];
    };
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/file-drop-target' {
  import Modifier from 'ember-modifier';

  export default class DndFileDropTargetModifier extends Modifier<{
    Args: {
      Named: {
        accept?: string[];
        disabled?: boolean;
        isDraggingOverClass?: string;
        multiple?: boolean;
        onDragEnter?: (event: DragEvent) => void;
        onDragLeave?: (event: DragEvent) => void;
        onDrop?: (event: DragEvent, files: File[]) => void;
      };
      Positional: [];
    };
  }> {}
}
