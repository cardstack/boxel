import RouteTemplate from 'ember-route-template';

import BoxelSandboxRuntime from '@cardstack/host/components/boxel-sandbox-runtime';

import type { BoxelSandboxRuntimeModel } from '@cardstack/host/routes/boxel-sandbox-runtime';

interface Signature {
  Args: { model: BoxelSandboxRuntimeModel };
}

export default RouteTemplate<Signature>(
  <template><BoxelSandboxRuntime @model={{@model}} /></template>,
);
