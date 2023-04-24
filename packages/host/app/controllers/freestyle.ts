import FreestyleController from 'ember-freestyle/controllers/freestyle';
import SearchBarUsage from '@cardstack/host/components/search-bar/usage';
import formatComponentName from '../helpers/format-component-name';
import { ComponentLike } from '@glint/template';

interface UsageComponent {
  title: string;
  component: ComponentLike;
}

export default class IndexController extends FreestyleController {
  formatComponentName = formatComponentName;
  usageComponents: UsageComponent[];
  constructor(...args: any[]) {
    super(...args);
    this.usageComponents = [['SearchBarUsage', SearchBarUsage]].map(
      ([name, c]) => {
        return {
          title: name,
          component: c,
        };
      }
    ) as UsageComponent[];
  }
}
