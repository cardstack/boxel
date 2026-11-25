import { helper } from '@ember/component/helper';
import type { ComponentLike } from '@glint/template';

import type { Icon } from '../icons/types.ts';

export type MenuAction = () => void;

export interface MenuItemOptions {
  action: MenuAction;
  checked?: boolean;
  dangerous?: boolean;
  disabled?: boolean;
  header?: boolean;
  icon?: Icon;
  iconURL?: string;
  id?: string;
  inactive?: boolean;
  label: string;
  postscript?: string;
  // Rendered after the label, in place of `postscript`, for a mark such as
  // a count the label doesn't carry.
  postscriptComponent?: ComponentLike;
  subtext?: string;
  subtextComponent?: ComponentLike;
  tags?: string[];
}

export class MenuItem {
  label: string;
  action: MenuAction;
  dangerous: boolean;
  checked: boolean;
  disabled: boolean;
  header: boolean;
  icon: Icon | undefined;
  iconURL: string | undefined;
  url: string | undefined;
  inactive: boolean | undefined;
  id?: string;
  subtext?: string;
  postscript?: string;
  postscriptComponent?: ComponentLike;
  subtextComponent?: ComponentLike;
  tags: string[];
  isDivider = false;

  constructor(options: MenuItemOptions) {
    this.label = options.label;
    this.action = options.action;
    this.id = options.id;
    this.dangerous = options.dangerous || false;
    this.checked = options.checked || false;
    this.disabled = options.disabled || false;
    this.header = options.header || false;
    this.icon = options.icon || undefined;
    this.iconURL = options.iconURL || undefined;
    this.inactive = options.inactive;
    this.subtext = options.subtext;
    this.postscript = options.postscript;
    this.postscriptComponent = options.postscriptComponent;
    this.subtextComponent = options.subtextComponent;
    this.tags = options.tags || [];
  }
}

export function toMenuItems(options: MenuItemOptions[]): MenuItem[] {
  return options.map((opts) => new MenuItem(opts));
}

export function menuItemFunc(
  params: [string, MenuAction],
  named: Omit<MenuItemOptions, 'label' | 'action'>,
): MenuItem {
  let opts: MenuItemOptions = Object.assign(
    { label: params[0], action: params[1] },
    named,
  );
  return new MenuItem(opts);
}

export default helper(menuItemFunc);
