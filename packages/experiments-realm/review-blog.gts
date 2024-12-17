import CategoriesIcon from '@cardstack/boxel-icons/hierarchy-3';
import BlogPostIcon from '@cardstack/boxel-icons/newspaper';
import AuthorIcon from '@cardstack/boxel-icons/square-user';

import { type LayoutFilter } from './components/layout';
import { BlogApp, SORT_OPTIONS } from './blog-app';

const FILTERS: LayoutFilter[] = [
  {
    displayName: 'Posts',
    icon: BlogPostIcon,
    cardTypeName: 'Review',
    createNewButtonText: 'Post',
    showAdminData: true,
    sortOptions: SORT_OPTIONS,
  },
  {
    displayName: 'Author Bios',
    icon: AuthorIcon,
    cardTypeName: 'Author',
    createNewButtonText: 'Author',
  },
  {
    displayName: 'Categories',
    icon: CategoriesIcon,
    cardTypeName: 'Category',
    createNewButtonText: 'Category',
    isCreateNewDisabled: true, // TODO: Category cards
  },
];

export class ReviewBlog extends BlogApp {
  static displayName = 'Review Blog';
  filters = FILTERS;
}
