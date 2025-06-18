import { helper } from '@ember/component/helper';
import type { Link } from 'ember-link';

import type { Icon } from '../icons/types.ts';

// eslint-disable-next-line @typescript-eslint/ban-types
type ActionType = Link | Function;

interface MenuItemOptions {
  action: ActionType;
  dangerous: boolean;
  disabled: boolean;
  header: boolean;
  icon: Icon;
  iconURL: string;
  id?: string;
  inactive: boolean;
  postscript?: string;
  selected: boolean;
  subtext?: string;
  tabindex: number | string;
  url: string;
}
export class MenuItem {
  text: string;
  type: string;
  dangerous: boolean;
  selected: boolean;
  disabled: boolean;
  header: boolean;
  icon: Icon | undefined;
  iconURL: string | undefined;
  action: ActionType | undefined;
  url: string | undefined;
  inactive: boolean | undefined;
  tabindex: number | string | undefined;
  id?: string;
  subtext?: string;
  postscript?: string;

  constructor(text: string, type: string, options: Partial<MenuItemOptions>) {
    this.text = text;
    this.type = type;
    this.action = options.action;
    this.id = options.id;
    this.dangerous = options.dangerous || false;
    this.selected = options.selected || false;
    this.disabled = options.disabled || false;
    this.header = options.header || false;
    this.icon = options.icon || undefined;
    this.iconURL = options.iconURL || undefined;
    this.inactive = options.inactive;
    this.tabindex = options.tabindex || 0;
    this.subtext = options.subtext ?? undefined;
    this.postscript = options.postscript ?? undefined;
  }
}

export function menuItemFunc(
  params: [string, ActionType],
  named: Partial<MenuItemOptions>,
): MenuItem {
  let text = params[0];
  let opts = Object.assign({}, named);
  opts.action = params[1];
  return new MenuItem(text, 'action', opts);
}

export default helper(menuItemFunc);
