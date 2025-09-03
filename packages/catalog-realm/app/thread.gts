import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

import { QueryField } from '../fields/query';
import { AppCard } from './app';

class IsolatedTemplate extends Component<typeof ThreadApp> {
  <template>
    <div class='thread-app'>
      <h1>Thread App</h1>
      <div class='query-section'>
        <@fields.query />
      </div>
    </div>
  </template>
}

export class ThreadApp extends AppCard {
  static displayName = 'Thread App';
  @field query = contains(QueryField);

  static isolated = IsolatedTemplate;
}
