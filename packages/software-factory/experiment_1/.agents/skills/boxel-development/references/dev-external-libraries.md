**Async loading pattern:**
```gts
import { task, restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';

private loadLibrary = task(async () => {
  const script = document.createElement('script');
  script.src = 'https://cdn.../library.js';
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
});
```

**Key Rules:**
1. Use Modifiers for DOM access
2. Use ember-concurrency tasks for async
3. Bind external data to model fields
4. Provide loading states

**Task types:**
- `task` - Concurrent execution
- `restartableTask` - Cancel previous, start new
- `enqueueTask` - Sequential queue
- `dropTask` - Ignore new while running

## Async loading from within components

For fetching data from external APIs, use `ember-concurrency`. The core of this principle are "tasks", which are a cancelable alternative to promises. The most used ones are `task`, and `restartableTask`:

- task: Tasks run concurrently without any coordination, allowing multiple instances to execute simultaneously.
- restartableTask: Cancels any running task and immediately starts a new one when performed, ensuring only the latest task runs.
- enqueueTask: Queues tasks to run sequentially one after another, ensuring no overlap but preserving all tasks.
- dropTask: Ignores new task requests while one is already running, preventing any additional instances from starting.
- keepLatest: Drops intermediate queued tasks but keeps the most recent one to run after the current task completes.

Here is an example where we are:
- loading data when component is first rendered, 
- reloading it when user clicks on a button,
- adding some artificial delay using `await timeout(ms)` from `ember-concurrency`. Caution:  do not use `setTimeout`.

```
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import perform from 'ember-concurrency/helpers/perform';

export class CurrencyLoader extends CardDef {
  static displayName = 'Currency Loader';
  
  @field loadingStatus = contains(StringField);
  @field currencies = contains(StringField);
  
  static isolated = class Isolated extends Component<typeof this> {
    constructor(owner: any, args: any) {
      super(owner, args);
      this.loadCurrencies.perform();
    }
    
    private loadCurrencies = restartableTask(async () => {
      this.args.model.loadingStatus = 'Loading...';
      const response = await fetch('/api/currencies');
      await timeout(1000); // Visual feedback
      
      this.args.model.currencies = await response.json();
      this.args.model.loadingStatus = "";
    });
    
    <template>
      <div>
        <p>Status: {{@model.loadingStatus}}</p>
        <p>Data: {{@model.currencies}}</p>
        
        <Button {{on 'click' (perform this.loadCurrencies)}}>
          Reload Currencies
        </Button>
      </div>
    </template>
  };
}
```

## External Libraries: Bringing Third-Party Power to Boxel

**When to Use External Libraries:** Sometimes you need specialized functionality like 3D graphics (Three.js), data visualization (D3), or charts. Boxel plays well with external libraries when you follow the right patterns.

**Key Rules:**
1. **Always use Modifiers for DOM access** - Never manipulate DOM directly
2. **Use ember-concurrency tasks** for async operations like loading libraries
3. **Bind external data to model fields** for reactive updates
4. **Use proper loading states** while libraries initialize