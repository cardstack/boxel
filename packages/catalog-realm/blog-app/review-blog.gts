import MovieIcon from '@cardstack/boxel-icons/movie';
import BlogPostIcon from '@cardstack/boxel-icons/newspaper';
import AuthorIcon from '@cardstack/boxel-icons/square-user';
import CategoriesIcon from '@cardstack/boxel-icons/hierarchy-3';
import { codeRef } from '@cardstack/runtime-common';
import { type LayoutFilter } from '../components/layout';
import { BlogApp } from './blog-app';

// @ts-expect-error import.meta is valid ESM but TS detects .gts as CJS
const here: string = import.meta.url;

export class ReviewBlog extends BlogApp {
  static displayName = 'Review Blog';
  static icon = MovieIcon;

  static filterList: LayoutFilter[] = [
    {
      displayName: 'Posts',
      icon: BlogPostIcon,
      cardTypeName: 'Review',
      createNewButtonText: 'Post',
      showAdminData: true,
      sortOptions: BlogApp.sortOptionList,
      cardRef: codeRef(here, './review', 'Review'),
    },
    {
      displayName: 'Authors',
      icon: AuthorIcon,
      cardTypeName: 'Author',
      createNewButtonText: 'Author',
      cardRef: codeRef(here, './author', 'Author'),
    },
    {
      displayName: 'Categories',
      icon: CategoriesIcon,
      cardTypeName: 'Category',
      createNewButtonText: 'Category',
      cardRef: codeRef(here, './blog-category', 'BlogCategory'),
    },
  ];
}
