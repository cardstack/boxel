import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

const Loading: TemplateOnlyComponent = <template>
  <div id='host-loading' data-test-host-loading>
    <div class='loading-container'>
      <div class='loading-indicator'>
        <LoadingIndicator @color='#00FFBA' />
      </div>
      <div class='loading-text'>Loading…</div>
    </div>
  </div>

  <style scoped>
    #host-loading {
      background-color: #686283;
      display: flex;
      align-items: center;
      justify-items: center;
      height: 100vh;
    }

    .loading-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .loading-indicator {
      --boxel-loading-indicator-size: 20px;
    }

    .loading-text {
      color: #fff;
      font-size: 12px;
      font-weight: 600;
    }
  </style>
</template>;

export default RouteTemplate(Loading);
