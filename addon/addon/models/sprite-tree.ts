import Sprite from './sprite';
import { Changeset } from './changeset';
import { AnimationDefinition } from './orchestration';

export interface IContext {
  id: string | undefined;
  element: Element; // TODO can we change this to HTMLElement
  isInitialRenderCompleted: boolean;
  isStable: boolean;
  orphans: Map<string, HTMLElement>;
  shouldAnimate(): boolean;
  hasOrphan(spriteOrElement: Sprite): boolean;
  removeOrphan(spriteOrElement: Sprite): void;
  appendOrphan(spriteOrElement: Sprite): void;
  clearOrphans(): void;
  args: {
    use?(changeset: Changeset): AnimationDefinition;
    id?: string;
  };
}

export interface ISpriteModifier {
  id: string;
  role: string | null;
  element: Element; // TODO can we change this to HTMLElement
}
