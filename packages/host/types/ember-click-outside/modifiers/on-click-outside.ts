import type { ModifierLike } from '@glint/template';

interface OnClickOutsideSignature {
  Element: HTMLElement;
  Args: {
    Named: {
      capture?: boolean;
      eventType?: string;
      exceptSelector?: string;
    };
    Positional: [action: (event: Event) => void];
  };
}

declare const onClickOutside: ModifierLike<OnClickOutsideSignature>;
export default onClickOutside;
