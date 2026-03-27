import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import SortDropdown, { type SortOption } from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class SortDropdownUsage extends Component<Signature> {
  private options: SortOption[] = [
    {
      displayName: 'A-Z',
      sort: [
        {
          by: 'cardTitle',
          direction: 'asc',
        },
      ],
    },
    {
      displayName: 'Last Updated',
      sort: [
        {
          by: 'lastModified',
          direction: 'desc',
        },
      ],
    },
    {
      displayName: 'Date Created',
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    },
  ];

  @tracked private selectedOption?: SortOption = this.options[0];

  private onSelect = (option: SortOption) => {
    this.selectedOption = option;
  };

  <template>
    <FreestyleUsage @name='SortDropdown'>
      <:example>
        <SortDropdown
          @options={{this.options}}
          @onSelect={{this.onSelect}}
          @selectedOption={{this.selectedOption}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @description='SortOption objects'
          @value={{this.options}}
          @required={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='Action on select'
          @required={{true}}
        />
        <Args.Object
          @name='selectedOption'
          @description='Selected SortOption'
          @value={{this.selectedOption}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
