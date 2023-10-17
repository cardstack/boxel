declare module 'ember-basic-dropdown/components/basic-dropdown' {
  /* eslint-disable @typescript-eslint/ban-types */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /* eslint-disable ember/no-empty-glimmer-component-classes */
  import Component from '@glimmer/component';
  import { ComponentLike } from '@glint/template';

  // FIXME can these types be extracted from ember-basic-dropdown exports without using …/addon?
  interface CalculatePositionOptions {
    dropdown: any;
    horizontalPosition: string;
    matchTriggerWidth: boolean;
    previousHorizontalPosition?: string;
    previousVerticalPosition?: string;
    renderInPlace: boolean;
    verticalPosition: string;
  }
  export type CalculatePositionResultStyle = {
    [key: string]: string | number | undefined;
    height?: number;
    left?: number;
    right?: number;
    top?: number;
    width?: number;
  };
  export type CalculatePositionResult = {
    horizontalPosition: string;
    style: CalculatePositionResultStyle;
    verticalPosition: string;
  };
  export type CalculatePosition = (
    trigger: Element,
    content: HTMLElement,
    destination: HTMLElement,
    options: CalculatePositionOptions,
  ) => CalculatePositionResult;

  interface Args {
    calculatePosition?: CalculatePosition;
    destination?: string;
    disabled?: boolean;
    dropdownId?: string;
    horizontalPosition?: string;
    initiallyOpened?: boolean;
    matchTriggerWidth?: boolean;
    onClose?: Function;
    onInit?: Function;
    onOpen?: Function;
    registerAPI?: Function;
    renderInPlace?: boolean;
    verticalPosition?: string;
  }
  export type BasicDropdownArgs = Args;

  export type BasicDropdownTriggerArgs = {
    dropdown: Dropdown;
    eventType: 'click' | 'mousedown';
    onBlur?: (dropdown?: Dropdown, event?: FocusEvent) => void;
    onClick?: (dropdown?: Dropdown, event?: MouseEvent) => void;
    onFocus?: (dropdown?: Dropdown, event?: FocusEvent) => void;
    onFocusIn?: (dropdown?: Dropdown, event?: FocusEvent) => void;
    onFocusOut?: (dropdown?: Dropdown, event?: FocusEvent) => void;
    onKeyDown?: (dropdown?: Dropdown, event?: KeyboardEvent) => void;
    onMouseDown?: (dropdown?: Dropdown, event?: MouseEvent) => void;
    onMouseEnter?: (dropdown?: Dropdown, event?: MouseEvent) => void;
    onMouseLeave?: (dropdown?: Dropdown, event?: MouseEvent) => void;
    onTouchEnd?: (dropdown?: Dropdown, event?: TouchEvent) => void;
    stopPropagation: boolean;
  };

  type RepositionChanges = {
    hPosition: string;
    height?: string;
    left?: string;
    otherStyles: Record<string, string | number | undefined>;
    right?: string;
    top?: string;
    vPosition: string;
    width?: string;
  };

  interface DropdownActions {
    close: (e?: Event, skipFocus?: boolean) => void;
    open: (e?: Event) => void;
    reposition: (...args: any[]) => undefined | RepositionChanges;
    toggle: (e?: Event) => void;
  }
  interface Dropdown {
    actions: DropdownActions;
    disabled: boolean;
    isOpen: boolean;
    uniqueId: string;
  }

  interface BasicDropdownContentArgs {
    destination: string;
    dropdown: Dropdown;
    height: string | undefined;
    isTouchDevice?: boolean;
    left: string | undefined;
    onFocusIn?: (dropdown?: Dropdown, event?: FocusEvent) => void;
    onFocusOut?: (dropdown?: Dropdown, event?: FocusEvent) => void;
    onMouseEnter?: (dropdown?: Dropdown, event?: MouseEvent) => void;
    onMouseLeave?: (dropdown?: Dropdown, event?: MouseEvent) => void;
    otherStyles: Record<string, string>;
    preventScroll?: boolean;
    renderInPlace: boolean;
    right: string | undefined;
    rootEventType: 'click' | 'mousedown';
    shouldReposition: (
      mutations: MutationRecord[],
      dropdown: Dropdown,
    ) => boolean;
    top: string | undefined;
    transitionedInClass?: string;
    transitioningInClass?: string;
    transitioningOutClass?: string;
    width: string | undefined;
  }

  export default class BasicDropdown extends Component<{
    Args: BasicDropdownArgs;
    Blocks: {
      default: [
        {
          Content: ComponentLike<{
            Args: Partial<BasicDropdownContentArgs>;
            Blocks: { default: [] };
            Element: HTMLDivElement;
          }>;
          Trigger: ComponentLike<{
            Args: Partial<BasicDropdownTriggerArgs>;
            Blocks: { default: [] };
            Element: HTMLDivElement;
          }>;
          actions: DropdownActions;
          disabled: Dropdown['disabled'];
          isOpen: Dropdown['isOpen'];
          uniqueId: Dropdown['uniqueId'];
        },
      ];
    };
    Element: HTMLDivElement;
  }> {}
}
