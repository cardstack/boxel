import { service } from '@ember/service';

import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import type ContextForAiAssistantService from '@cardstack/host/services/context-for-ai-assistant-service';

interface Signature {
  Args: {
    values: Record<string, unknown>;
  };
}

const ValuesDidUpdate = modifier(
  (
    _element: HTMLElement,
    _positional: [],
    {
      values,
      service,
    }: {
      values: Record<string, unknown>;
      service: ContextForAiAssistantService;
    },
  ) => {
    Object.entries(values).forEach(([key, value]) => {
      service.set(key, value);
    });
  },
);

// The goal of this component is to set any kind of context that the user sees
// in the interface to the AI assistant. We use this context to send to the
// LLM (via the assistant) when sending messages to the bot so that the LLM
// can make better informed suggestions. Given that a lot of this context lives
// as local state in different components, it's tricky to gather all of it
// - for this purpose we have this component that you put in any template and
// it will set the properties we are interested in to the ContextForAiAssistant
// service.
//
// For example, if you are in the playground panel, you can do this:
//
// <ReportUserContextForAiAssistant
//   @values={{hash playgroundPanelCardId=this.card.id playgroundPanelFormat=this.format}}
// />
export default class ReportUserContextForAiAssistant extends Component<Signature> {
  @service declare contextForAiAssistantService: ContextForAiAssistantService;
  <template>
    <span
      {{ValuesDidUpdate
        values=@values
        service=this.contextForAiAssistantService
      }}
    >
    </span>
  </template>
}
