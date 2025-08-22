import MovieIcon from '@cardstack/boxel-icons/movie';
import BlogPostIcon from '@cardstack/boxel-icons/newspaper';
import AuthorIcon from '@cardstack/boxel-icons/square-user';
import CategoriesIcon from '@cardstack/boxel-icons/hierarchy-3';
import { type LayoutFilter } from '../components/layout';
import { BlogApp } from './blog-app';

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
      cardRef: {
        name: 'Review',
        module: new URL('./review', import.meta.url).href,
      },
    },
    {
      displayName: 'Authors',
      icon: AuthorIcon,
      cardTypeName: 'Author',
      createNewButtonText: 'Author',
      cardRef: {
        name: 'Author',
        module: new URL('./author', import.meta.url).href,
      },
    },
    {
      displayName: 'Categories',
      icon: CategoriesIcon,
      cardTypeName: 'Category',
      createNewButtonText: 'Category',
      cardRef: {
        name: 'BlogCategory',
        module: new URL('./blog-category', import.meta.url).href,
      },
    },
  ];
}
