interface AnimationsService {}

interface SpriteTree {}

interface SpriteTreeNode {}

interface UIElement {
  state: 'REMOVED' | 'INSERTED' | 'KEPT';
  identifier: string;
  canBeCleanedUp: boolean;
  uiState: {
    beforeRender: UIState;
    afterRender: UIState;
  };
  nodes: {
    currentElement: SpriteTreeNode;
    previousElement: SpriteTreeNode;
  };
  animations: {
    currentElement?: {
      target: HTMLElement;
      animation: Animation;
    };
    previousElement?: {
      target: HTMLElement;
      animation: Animation;
    };
  };
  currentElement: HTMLElement;
  previousElement: HTMLElement;
  measureBeforeRender(): void;
  measureAfterRender(): void;
}

interface Sprite {}

interface IContext {}

interface ISpriteModifier {}

interface ChangesetBuilder {}

interface Changeset {}
