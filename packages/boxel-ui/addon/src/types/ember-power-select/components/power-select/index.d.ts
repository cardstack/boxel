/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable ember/no-empty-glimmer-component-classes */

// FIXME can these types be extracted from ember-power-select exports without using …/addon?

import Component from '@glimmer/component';
import { ComponentLike } from '@glint/template';

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

type MatcherFn = (option: any, text: string) => number;

interface SelectActions extends DropdownActions {
  choose: (selected: any, e?: Event) => void;
  highlight: (option: any) => void;
  scrollTo: (option: any) => void;
  search: (term: string) => void;
  select: (selected: any, e?: Event) => void;
}

export interface Select extends Dropdown {
  actions: SelectActions;
  highlighted: any;
  isActive: boolean;
  lastSearchedText: string;
  loading: boolean;
  options: any[];
  results: any[];
  resultsCount: number;
  searchText: string;
  selected: any;
}
interface PromiseProxy<T> extends Promise<T> {
  content: any;
}

export interface PowerSelectArgs {
  beforeOptionsComponent?: string | ComponentLike<BeforeOptionsArgs>;
  buildSelection?: (selected: any, select: Select) => any;
  closeOnSelect?: boolean;
  defaultHighlighted?: any;
  disabled?: boolean;
  dropdownClass?: string;
  eventType?: 'click' | 'mousedown';
  groupComponent?: string;
  highlightOnHover?: boolean;
  initiallyOpened?: boolean;
  matchTriggerWidth?: boolean;
  matcher?: MatcherFn;
  noMatchesMessage?: string;
  noMatchesMessageComponent?: string;
  onBlur?: (select: Select, event: FocusEvent) => void;
  onChange: (selection: any, select: Select, event?: Event) => void;
  onClose?: (select: Select, e: Event) => boolean | undefined;
  onFocus?: (select: Select, event: FocusEvent) => void;
  onInput?: (term: string, select: Select, e: Event) => string | false | void;
  onKeydown?: (select: Select, e: KeyboardEvent) => boolean | undefined;
  onOpen?: (select: Select, e: Event) => boolean | undefined;
  options: any[] | PromiseProxy<any[]>;
  optionsComponent?: string;
  placeholder?: string;
  placeholderComponent?: string;
  registerAPI?: (select: Select) => void;
  renderInPlace?: boolean;
  scrollTo?: (option: any, select: Select) => void;
  search?: (term: string, select: Select) => any[] | PromiseProxy<any[]>;
  searchEnabled?: boolean;
  searchField?: string;
  searchMessage?: string;
  searchMessageComponent?: string;
  selected: any | PromiseProxy<any>;
  selectedItemComponent?: string | ComponentLike;
  tabindex?: number | string;
  triggerComponent?: string;
  typeAheadOptionMatcher?: MatcherFn;
  verticalPosition?: 'auto' | 'below' | 'above';
}

import {
  BasicDropdownArgs,
  BasicDropdownTriggerArgs,
} from 'ember-basic-dropdown/components/basic-dropdown';

interface BeforeOptionsArgs {
  autofocus?: boolean;
  onKeydown: (e: Event) => false | void;
  select: Select;
}
export class BeforeOptions extends Component<BeforeOptionsArgs> {
  clearSearch(): void;
  handleKeydown(e: KeyboardEvent): false | void;
  focusInput(el: HTMLElement): void;
}

type SharedDropdownType = Pick<
  BasicDropdownArgs,
  'renderInPlace' | 'disabled'
> &
  Partial<Pick<BasicDropdownTriggerArgs, 'eventType'>>;

export interface PatchedPowerSelectArgs
  extends PowerSelectArgs,
    SharedDropdownType {
  dropdownClass?: string;
  placeholder?: string;
  selectedItemComponent?: string | ComponentLike;
  verticalPosition?: 'auto' | 'below' | 'above';
}

export default class PowerSelect extends Component<{
  Args: PowerSelectArgs;
  // TODO: figure out property types for default block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Blocks: { default: [any, any] };
  Element: HTMLDivElement;
}> {}
