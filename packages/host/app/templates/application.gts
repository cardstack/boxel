import { on } from '@ember/modifier';

import { run } from '@ember/runloop';
import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';

import App from '../app';

interface ApplicationRouteSignature {
  Args: {};
}

class ApplicationRouteComponent extends Component<ApplicationRouteSignature> {
  tryPrerender = async () => {
    let app = App.create({
      autoboot: false /* TODO: consider merging with the normal config/environment */,
    });

    // await app.boot({ location: 'none', rootElement: '#my-prerender-target' });
    // let instance = app.buildInstance();

    await app.boot();

    let instance = app.buildInstance();
    try {
      await instance.boot({
        location: 'none',
        rootElement: '#my-prerender-target',
      });
      instance.register(
        'prerender-options:main',
        {
          log: function () {
            console.log('it works');
          },
        },
        {
          instantiate: false,
        },
      );
      await instance.visit(
        '/prerender/http%3A%2F%2Flocalhost%3A4201%2Fdrafts%2FBlogPost%2F1',
      );
    } catch (err) {
      run(instance, 'destroy');
      throw err;
    }
  };

  <template>
    <button {{on 'click' this.tryPrerender}}>Go</button>
    {{outlet}}
    <CardPrerender />

    {{! this is a signal for the Realm DOM tests to know that app has loaded }}
    {{! template-lint-disable no-inline-styles }}
    <div data-test-boxel-root style='display: none;'></div>
  </template>
}

export default RouteTemplate(ApplicationRouteComponent);
