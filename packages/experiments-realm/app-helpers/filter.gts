import { type Query, type ResolvedCodeRef } from '@cardstack/runtime-common';
import IconComponent from '@cardstack/boxel-icons/captions';
import type { SortOption } from './sort';

export interface SidebarFilter {
  displayName: string;
  icon: typeof IconComponent;
  cardTypeName: string;
  createNewButtonText?: string;
  isCreateNewDisabled?: boolean;
  cardRef?: ResolvedCodeRef;
  query?: Query;
  sortOptions?: SortOption[];
  selectedSort?: SortOption;
  showAdminData?: boolean;
}
