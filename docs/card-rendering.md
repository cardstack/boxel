# Card Rendering

Since cards are neither HTML nor Ember components, they cannot be directly compiled by browsers or Glimmer. Therefore, to compile a card, it needs to be transformed from a card instance into an Ember component and then served as HTML. This transformation process primarily occurs in the [`packages/host/app/services/render-service.gts`](../packages/host/app/components/card-prerender.gts)which utilizes an [isolated `render()` function](../packages/host/app/lib/isolated-render.gts). This render() function offers a Glimmer rendering context, which keeps its errors isolated from the main Glimmer render process that renders the host app.

```mermaid
sequenceDiagram
participant RenderService
participant CardInstance
participant SimpleDocument
participant IsolatedRender
participant Glimmer
RenderService->>CardInstance: get ember component by format (isolated or embedded or edit), getComponent(card, format)
RenderService->>SimpleDocument: get isolated render element
SimpleDocument-->>RenderService: element
RenderService->>IsolatedRender: render(component, element, this.owner)
IsolatedRender->>IsolatedRender: convert component to layout
IsolatedRender-->>RenderService: element with html document value
RenderService->>RenderService: serialize element to html
RenderService->>RenderService: return html