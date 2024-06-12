declare module 'ember-sortable/modifiers/sortable-group' {
  /* eslint-disable @typescript-eslint/ban-types */
  import Modifier from 'ember-modifier';

  export default class SortableGroupModifier extends Modifier<{
    Args: {
      Named: {
        a11yAnnouncementConfig?: () => void;
        a11yItemName?: string;
        disabled?: boolean;
        handleVisualClass?: string;
        itemVisualClass?: string;
        onChange?: (itemModels: any, draggedModel: any) => void;
      };
      Positional: [];
    };
  }> {}
}

declare module 'ember-sortable/modifiers/sortable-handle' {
  import Modifier from 'ember-modifier';

  export default class SortableHandleModifier extends Modifier<{
    Args: {
      Named: {};
      Positional: [];
    };
  }> {}
}

declare module 'ember-sortable/modifiers/sortable-item' {
  import Modifier from 'ember-modifier';

  export default class SortableItemModifier extends Modifier<{
    Args: {
      Named: {
        disabled?: boolean;
        distance?: number;
        groupName?: string;
        handle?: string;
        isDraggingDisabled?: boolean;
        model?: any;
        onDragStart?: () => void;
        onDragStop?: () => void;
        spacing?: number;
        updateInterval?: number;
      };
      Positional: [];
    };
  }> {}
}
