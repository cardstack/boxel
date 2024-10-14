declare module 'ember-draggable-modifiers/modifiers/sortable-item' {
  import Modifier from 'ember-modifier';

  export default class SortableItemModifier extends Modifier<{
    Args: {
      Named: {
        data?: any;
        group?: string;
        accepts?: string[];
        dragHandleElement?: string;
        direction?: 'horizontal' | 'vertical';
        allowedEdges?: ('top' | 'bottom' | 'left' | 'right')[];
        allowDropOnItself?: boolean;
        allowDropOnChildren?: boolean;
        disabled?: boolean;
        disabledDrag?: boolean;
        disabledDrop?: boolean;
        isDraggingClass?: string;
        isOnTargetClass?: string;
        canDrop?: (event: DragEvent) => boolean;
        onDrop?: (event: DragEvent, item: any) => void;
        onHover?: (event: DragEvent) => void;
        onDragEnter?: (event: DragEvent) => void;
        onDragLeave?: (event: DragEvent) => void;
        onDragStart?: (event: DragEvent) => void;
        onDragEnd?: (event: DragEvent) => void;
      };
      Positional: [];
    };
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/draggable-item' {
  import Modifier from 'ember-modifier';

  export default class DraggableItemModifier extends Modifier<{
    Args: {
      Named: {
        data?: any;
        group?: string;
        dragHandleElement?: string;
        disabled?: boolean;
        isDraggingClass?: string;
        onDragStart?: (event: DragEvent) => void;
        onDragEnd?: (event: DragEvent) => void;
        onDrop?: (event: { source: unknown; destination: unknown }) => void;
      };
      Positional: [];
    };
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/drop-target' {
  import Modifier from 'ember-modifier';

  export default class DropTargetModifier extends Modifier<{
    Args: {
      Named: {
        data?: any;
        group?: string;
        accepts?: string[];
        direction?: 'horizontal' | 'vertical';
        allowedEdges?: ('top' | 'bottom' | 'left' | 'right')[];
        allowDropOnItself?: boolean;
        allowDropOnChildren?: boolean;
        disabled?: boolean;
        isOnTargetClass?: string;
        canDrop?: (event: DragEvent) => boolean;
        onDrop?: (event: DragEvent, item: any) => void;
        onHover?: (event: DragEvent) => void;
        onDragEnter?: (event: DragEvent) => void;
        onDragLeave?: (event: DragEvent) => void;
      };
      Positional: [];
    };
  }> {}
}

declare module 'ember-draggable-modifiers/modifiers/draggable-item-handle' {
  import Modifier from 'ember-modifier';

  export default class DraggableItemHandleModifier extends Modifier<{
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

  export default class FileDropTargetModifier extends Modifier<{
    Args: {
      Named: {
        accept?: string[];
        multiple?: boolean;
        disabled?: boolean;
        isDraggingOverClass?: string;
        onDragEnter?: (event: DragEvent) => void;
        onDragLeave?: (event: DragEvent) => void;
        onDrop?: (event: DragEvent, files: File[]) => void;
      };
      Positional: [];
    };
  }> {}
}
