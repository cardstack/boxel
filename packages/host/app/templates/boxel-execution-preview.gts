import RouteTemplate from 'ember-route-template';

import BoxelDocumentRenderer from '@cardstack/host/components/boxel-document-renderer';

import type { BoxelExecutionPreviewModel } from '@cardstack/host/routes/boxel-execution-preview';

interface Signature {
  Args: { model: BoxelExecutionPreviewModel };
}

export default RouteTemplate<Signature>(
  <template>
    <main class='boxel-execution-preview'>
      <BoxelDocumentRenderer @cardURL={{@model.cardURL}} />
    </main>

    <style scoped>
      .boxel-execution-preview {
        box-sizing: border-box;
        height: 100vh;
        overflow: auto;
        padding: 1rem;
        width: 100%;
      }
    </style>
  </template>,
);
