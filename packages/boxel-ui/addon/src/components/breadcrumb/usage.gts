/* eslint-disable no-console */

import Component from '@glimmer/component';

import Breadcrumb from './index.gts';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { CaretRight } from '@cardstack/boxel-ui/icons';
import { fn } from '@ember/helper';

export default class BreadcrumbUsage extends Component {
  @action goTo(href: string) {
    console.log(`going to link ${href}`);
  }
  <template>
    <Breadcrumb as |B|>
      <B {{on 'click' (fn this.goTo './')}}>
        <:content>Hi </:content>
      </B>
      <CaretRight width='12' height='12' role='presentation' />
      <B {{on 'click' (fn this.goTo './')}}>
        <:content>Bye </:content>
      </B>
      <CaretRight width='12' height='12' role='presentation' />
      <B {{on 'click' (fn this.goTo './')}}>
        <:content>What </:content>
      </B>

    </Breadcrumb>
  </template>
}
