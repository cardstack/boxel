# Indexing
When cards are created or updated we index their data. The indexing that is performed is driven by the HTML rendering of the card. The idea is that the actual HTML render of the card will indicate to us the fields that are actually used in the card as well as to define the indexing boundary for a card. Consider a social graph that contains a "Person" card which in turn has a "friends" field that links to Person cards that are the friends of a particular person. When indexing a particular instance of a Person card, the rendered HTML can help us to know how deep to traverse the friends of a Person card when assembling an index for a particular person. Without any kind of guidance a particular index for a person might include the entire network of people that exist in a social graph. However, using the HTML render for a card, the isolated card for a person could contain all the friends for a particular person, but the embedded card for a Person (which is the way a card appears when it is included in the context of another card) might only display the persons's avatar and their name--the 2nd order friends, thereby are not rendered. Using this HTML rendering of a Person instance, then, would only display the direct friends of a person and provide a natural way in which to prevent over indexing a person instance.

Using an HTML render driven indexing requires a different approach depending on the environment the indexing is performed: node vs service worker. In the node environment we use Fastboot to perform the indexing. In the service worker environment we leverage postMessage to communicate with the host application which in turn performs in the indexing off screen. In both cases we are relying on the host application to perform the indexing. In both cases the indexing is kicked off from the `SearchIndex` class in the [`packages/runtime-common/search-index.ts`](../packages/runtime-common/search-index.ts) module via the `SearchIndex.run()` method and the `SearchIndex.update()` method.

At the time of this writing, the `CardPrerender` component in the [`packages/host/components/card-prerender.gts`](../packages/host/app/components/card-prerender.gts) module is the primary module for driving the indexing from the host application. There is a registration process that binds the host application's `CardPrerender.fromScratch()` and `CardPrerender.incremental()` methods to the runtime-common's `SearchIndex.#fromScratch` and `SearchIndex.#incremental` private properties that both environments use to perform indexing.

## Node Environment 
In the node environment we leverage FastBoot's ability to define custom globals in the FastBoot sandbox as a means to register the `CardPrerender.fromScratch()` and `CardPrerender.incremental()` methods with the `SearchIndex` class. One of the globals that is passed into the FastBoot sandbox is the `RunnerRegistration`. This is a callback that the host app can use to give the outer context (i.e. the `SearchIndex` instance running in node) access to the `CardPrerender.fromScratch()` and `CardPrerender.incremental()` methods. While each visit to the FastBoot instance will have its own memory space, the sandbox globals are shared across all the visits (since the root of the state comes from the node env). To accommodate this we use a Map to keep the `RunnerRegistration` callbacks from colliding into one another during subsequent calls to visit the FastBoot instance. This map is managed by the `RunnerOptionsManager` class which is instantiated in node and maps a module scoped sequential ID to each visit of the FastBoot instance.

The `makeFastBootIndexRunner()` in [`packages/realm-server/fastboot.ts`](../packages/realm-server/fastboot.ts) is responsible for instantiating the FastBoot instance (which is shared amongst all the indexing invocations), assigning the sandbox globals for the FastBoot app, as well as for calling the the `visit()` function on the FastBoot index with the supplied identifier that maps to a bucket of state (`RunnerOpts`) unique to this particular indexing invocation. All this work is encapsulated in the `getRunner` callback function that `makeFastBootIndexRunner` returns.

```mermaid
sequenceDiagram
participant SearchIndex
participant RunnerOptionsManager
participant fastboot.ts
participant FastBoot
participant application route
participant indexer route
participant RenderService
participant CardPrerender
participant CurrentRun
SearchIndex->>SearchIndex: run()
SearchIndex->>RunnerOptionsManager: setOptions() - create new RunnerOpts state w/ ID
SearchIndex->>fastboot.ts: invoke getRunner() with RunnerOpts state ID
fastboot.ts->>FastBoot: visit(/indexer/:optsId)
activate FastBoot
FastBoot->>application route: render application
application route->>indexer route: enter route indexer with model: optsId
indexer route->>RenderService: defer fastboot rendering
RenderService->>FastBoot: defer rendering  (permits FastBoot rerendering until this promise is fulfilled)
application route->>CardPrerender: render
activate CardPrerender
CardPrerender->>RunnerOptionsManager: getRunnerOpts (which includes registerRunner callback) for optsId
Note right of RunnerOptionsManager: RunnerOptionsManager is FastBoot sandbox global
CardPrerender-->>SearchIndex: registerRunner(CardPrerender.fromScratch, CardPrerender.incremental)
Note right of SearchIndex: this wires together SearchIndex.fromScratch to CardPrerender.fromScratch
SearchIndex->>CardPrerender:fromScratch() - start full indexing
CardPrerender->>CurrentRun: fromScratch()
activate CurrentRun
CurrentRun->>RenderService: isolated render card 1
CurrentRun->>RenderService: isolated render card 2
CurrentRun->>RenderService: isolated render card n
CurrentRun-->>CardPrerender: indexing complete
deactivate CurrentRun
CardPrerender-->>RenderService: fullfill fastboot defered rendering
RenderService->>FastBoot: fullfull deferred rendering
deactivate FastBoot
CardPrerender-->>SearchIndex: indexing complete - returns updated index state
deactivate CardPrerender

```

## Service Worker Environment
In the service worker environment we take advantage of the host app running the DOM perform indexing by coordinating via postMessage between the service worker and the host app running in the DOM. In the `getRunner` callback that is passed to the `Realm` constructor for the service worker (from [packages/worker/src/main.ts](../packages/worker/src/main.ts)), we use the service worker's `MessageHandler.setupIndexRuner()` instance in [../packages/worker/src/message-handler.ts](../packages/worker/src/message-handler.ts). This method uses the `registerRunner` callback that is passed in as a parameter to wire it's own `MessageHandler.fromScratch()` and `MessageHandler.incremental()` methods to the outer closure's `SearchIndex.#fromScratch` and `SearchIndex.#incremental` private properties. The `MessageHandler.fromScratch()` and `incremental()` instances perform a postMessage call to the host application running in DOM. These messages to perform indexing are received by the [`LocalRealm` service](../packages/host/app/services/local-realm.ts) running in the host app. The [`CardPrerender` component](../packages/host/app/components/card-prerender.gts) in the host app is rendered in the [application template](../packages/host/app/templates/application.hbs). Within the `CardPrerender` constructor we set the `CardPrerender.fromScratch()` and `CardPrerender.incremental()` methods as properties on the `LocalRealm` service. This means that when the `LocalRealm` service receives a postMessage to perform indexing it can call the `CardPrerender.fromScratch()` or `CardPrerender.incremental()` methods that were bound to it, and then return the resulting index state as a postMessage response to the received indexing messages.

```mermaid
sequenceDiagram
participant SearchIndex
participant RunnerOptionsManager
participant MessageHandler
participant LocalRealm service
participant application route
participant CardPrerender
participant CurrentRun
application route->>CardPrerender: render component
CardPrerender->>LocalRealm service: setupIndexing(CardPrerender.fromScratch, CardPrerender.incremental)
Note right of LocalRealm service: this binds the CardPrerender.fromScratch() method as a property of LocalRealm
SearchIndex->>SearchIndex: run()
SearchIndex->>RunnerOptionsManager: setOptions() - create new RunnerOpts state w/ ID
SearchIndex->>MessageHandler: invoke getRunner() callback with RunnerOpts state ID
MessageHandler->>RunnerOptionsManager: getRunnerOpts (which includes registerRunner callback) for optsId
MessageHandler->>SearchIndex: registerRunner(MessageHandler.fromScratch, MessageHandler.incremental)
Note right of SearchIndex: this wires together SearchIndex.fromScratch to MessageHandler.fromScratch
SearchIndex->>MessageHandler:fromScratch() - start full indexing
MessageHandler->>LocalRealm service: postMessage({ type: 'startFromScratch'c})
LocalRealm service->>CardPrerender: fromScratch()
activate CardPrerender
CardPrerender->>CurrentRun: fromScratch()
activate CurrentRun
CurrentRun->>RenderService: isolated render card 1
CurrentRun->>RenderService: isolated render card 2
CurrentRun->>RenderService: isolated render card n
CurrentRun-->>CardPrerender: indexing complete
deactivate CurrentRun
CardPrerender-->>LocalRealm service: indexing complete - returns updated index state
LocalRealm service->>MessageHandler: postMessage({ type: 'fromScratchCompleted', state: serializedIndexState })
MessageHandler->>SearchIndex: indexing complete - returns deserialized index state
deactivate CardPrerender

```


## Indexing process
Once the environment has initiated the indexing, the host [`CardPrerender` component](../packages/host/app/components/card-prerender.gts) utilizes the [`CurrentRun` module](../packages/host/app/lib/current-run.ts) to perform the indexing. There are 2 flavors of indexing:
1. **From Scratch**

    From scratch indexing will index all the cards the entire realm. `CurrentRun` will start by visiting the directory the realm is mounted at and recursively descend through any subdirectories that it encounters, indexing all the card instances that it comes across.
   
2. **Incremental**

    Incremental indexing is used to index a specific item that changes and all the other items in the index that consume changed item either directly or indirectly. This is accomplished by recording all the dependencies (both instance and module dependencies) that an instances and modules have as we do the indexing. When an incremental index is requested, we traverse through the graph of dependencies that other items have on the changed index and invalidate all the consumers of the changed item. We remove all the invalidated items from a working copy of the index. We then instruct `CurrentRun` to visit all the invalidated items and whose entries are added to the working copy of the index. The working copy of the index then becomes the current index.
