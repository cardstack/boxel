import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import CliAuth from '@cardstack/host/components/matrix/cli-auth';

interface CliAuthRouteSignature {
  Args: {};
}

const CliAuthRouteComponent: TemplateOnlyComponent<CliAuthRouteSignature> =
  <template><CliAuth /></template>;

export default RouteTemplate(CliAuthRouteComponent);
