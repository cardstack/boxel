import * as emberComponent from '@ember/component';
import * as emberComponentTemplateOnly from '@ember/component/template-only';
import * as emberDestroyable from '@ember/destroyable';
import * as emberHelper from '@ember/helper';
import * as emberModifier from '@ember/modifier';
import * as emberObject from '@ember/object';
import * as emberObjectInternals from '@ember/object/internals';
//@ts-expect-error
import * as emberTemplateFactory from '@ember/template-factory';
import * as glimmerComponent from '@glimmer/component';
//@ts-ignore no types available
import * as glimmerTracking from '@glimmer/tracking';

import * as dateFns from 'date-fns';
import * as emberConcurrency from 'ember-concurrency';
//@ts-ignore no types available
import * as emberConcurrencyAsyncArrowRuntime from 'ember-concurrency/-private/async-arrow-runtime';
//@ts-ignore no types available
import * as emberModifier2 from 'ember-modifier';
import * as emberResources from 'ember-resources';
import * as ethers from 'ethers';
import * as flat from 'flat';
import * as lodash from 'lodash';
import * as marked from 'marked';
import * as tracked from 'tracked-built-ins';

import * as boxelAddButton from '@cardstack/boxel-ui/components/add-button';
import * as boxelButton from '@cardstack/boxel-ui/components/button';
import * as boxelCardContainer from '@cardstack/boxel-ui/components/card-container';
import * as boxelFieldContainer from '@cardstack/boxel-ui/components/field-container';
import * as boxelGridContainer from '@cardstack/boxel-ui/components/grid-container';
import * as boxelIconButton from '@cardstack/boxel-ui/components/icon-button';
import * as boxelInput from '@cardstack/boxel-ui/components/input';
import * as boxelLabel from '@cardstack/boxel-ui/components/label';
import * as boxelMessage from '@cardstack/boxel-ui/components/message';
import * as boxelTooltip from '@cardstack/boxel-ui/components/tooltip';
import * as boxelCssVar from '@cardstack/boxel-ui/helpers/css-var';
import * as boxelPickHelper from '@cardstack/boxel-ui/helpers/pick';
import * as boxelTruthHelpers from '@cardstack/boxel-ui/helpers/truth-helpers';
import * as boxelIconMinusCircle from '@cardstack/boxel-ui/icons/icon-minus-circle';
import * as boxelIconTrash from '@cardstack/boxel-ui/icons/icon-trash';

import * as runtime from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

export function shimExternals(loader: Loader) {
  loader.shimModule('@cardstack/runtime-common', runtime);
  loader.shimModule(
    '@cardstack/boxel-ui/components/add-button',
    boxelAddButton,
  );
  loader.shimModule('@cardstack/boxel-ui/components/button', boxelButton);
  loader.shimModule(
    '@cardstack/boxel-ui/components/icon-button',
    boxelIconButton,
  );
  loader.shimModule('@cardstack/boxel-ui/components/input', boxelInput);
  loader.shimModule(
    '@cardstack/boxel-ui/components/card-container',
    boxelCardContainer,
  );
  loader.shimModule(
    '@cardstack/boxel-ui/components/field-container',
    boxelFieldContainer,
  );
  loader.shimModule(
    '@cardstack/boxel-ui/components/grid-container',
    boxelGridContainer,
  );
  loader.shimModule('@cardstack/boxel-ui/components/label', boxelLabel);
  loader.shimModule('@cardstack/boxel-ui/components/message', boxelMessage);
  loader.shimModule('@cardstack/boxel-ui/components/tooltip', boxelTooltip);
  loader.shimModule('@cardstack/boxel-ui/icons/icon-trash', boxelIconTrash);
  loader.shimModule(
    '@cardstack/boxel-ui/icons/icon-minus-circle',
    boxelIconMinusCircle,
  );
  loader.shimModule('@cardstack/boxel-ui/helpers/css-var', boxelCssVar);
  loader.shimModule('@cardstack/boxel-ui/helpers/pick', boxelPickHelper);
  loader.shimModule(
    '@cardstack/boxel-ui/helpers/truth-helpers',
    boxelTruthHelpers,
  );
  loader.shimModule('@glimmer/component', glimmerComponent);
  loader.shimModule('@ember/component', emberComponent);
  loader.shimModule(
    '@ember/component/template-only',
    emberComponentTemplateOnly,
  );
  loader.shimModule('@ember/template-factory', emberTemplateFactory);
  loader.shimModule('@glimmer/tracking', glimmerTracking);
  loader.shimModule('@ember/object', emberObject);
  loader.shimModule('@ember/object/internals', emberObjectInternals);
  loader.shimModule('@ember/helper', emberHelper);
  loader.shimModule('@ember/modifier', emberModifier);
  loader.shimModule('ember-resources', emberResources);
  loader.shimModule('ember-concurrency', emberConcurrency);
  loader.shimModule(
    'ember-concurrency/-private/async-arrow-runtime',
    emberConcurrencyAsyncArrowRuntime,
  );
  loader.shimModule('ember-modifier', emberModifier2);
  loader.shimModule('flat', flat);
  loader.shimModule('lodash', lodash);
  loader.shimModule('tracked-built-ins', tracked);
  loader.shimModule('date-fns', dateFns);
  loader.shimModule('@ember/destroyable', emberDestroyable);
  loader.shimModule('marked', marked);
  loader.shimModule('ethers', ethers);
  loader.shimModule('ember-source/types', { default: class {} });
  loader.shimModule('ember-source/types/preview', { default: class {} });
}
