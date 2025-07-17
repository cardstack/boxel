import Component from '@glimmer/component';

import SubmodeLayout from './submode-layout';

export default class HostSubmode extends Component {
  <template>
    <SubmodeLayout class='host-submode-layout' data-test-host-submode>
      <div class='host-submode'>
        Host submode
      </div>
    </SubmodeLayout>

    <style scoped></style>
  </template>
}
