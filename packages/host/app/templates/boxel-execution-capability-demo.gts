import RouteTemplate from 'ember-route-template';

import BoxelExecutionCapabilityDemo from '@cardstack/host/components/boxel-execution-capability-demo';
import OperatorModeContainer from '@cardstack/host/components/operator-mode/container';

export default RouteTemplate(
  <template>
    <OperatorModeContainer>
      <BoxelExecutionCapabilityDemo />
    </OperatorModeContainer>
  </template>,
);
