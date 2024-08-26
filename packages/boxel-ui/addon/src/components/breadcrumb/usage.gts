/* eslint-disable no-console */

import Component from '@glimmer/component';

import BreadCrumb from './index.gts';

export default class BreadCrumbUsage extends Component {
  <template>
    Test
    <BreadCrumb as |B|>
      <B.Item>
        <:content>Hi </:content>
      </B.Item>
      <B.Item>
        <:content>Bye </:content>
      </B.Item>

    </BreadCrumb>
  </template>
}
