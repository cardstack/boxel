import {
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_FALLBACK_MODELS,
} from '@cardstack/runtime-common/matrix-constants';

import type { LLMOption } from '../components/ai-assistant/llm-select';
import type { SystemCard } from '@cardstack/base/system-card';

// The models a room's model picker offers, and so the only models a room may
// switch to: the system card's model configurations (or the curated fallback
// list when there is no system card), plus any model the room has used
// before, so that earlier chats stay selectable.
export function pickableModels(
  systemCard: SystemCard | undefined,
  usedLLMs: string[],
): LLMOption[] {
  if (systemCard?.modelConfigurations) {
    let options: LLMOption[] = [];
    let configModelIds = new Set<string>();
    for (let modelConfig of systemCard.modelConfigurations) {
      if (modelConfig.modelId && modelConfig.id) {
        options.push({
          id: modelConfig.id,
          modelId: modelConfig.modelId,
          name: modelConfig.cardTitle || modelConfig.modelId,
        });
        configModelIds.add(modelConfig.modelId);
      }
    }
    for (let usedLLM of usedLLMs) {
      if (usedLLM && !configModelIds.has(usedLLM)) {
        options.push({ id: usedLLM, modelId: usedLLM, name: usedLLM });
      }
    }
    return options;
  }

  // A used model that is not in the curated set shows its raw model id.
  let fallbackById = new Map(
    DEFAULT_FALLBACK_MODELS.map((m) => [m.modelId, m]),
  );
  let allIds = new Set<string>(fallbackById.keys());
  for (let usedLLM of usedLLMs) {
    if (usedLLM) {
      allIds.add(usedLLM);
    }
  }
  return [...allIds].sort().map((id) => ({
    id,
    modelId: id,
    name: fallbackById.get(id)?.displayName ?? id,
  }));
}

// The models a room has used, from its active-LLM events, in the order the
// room first used them.
export function usedLLMsFromEvents(
  events: { type: string; content?: unknown }[],
): string[] {
  let usedLLMs = new Set<string>();
  for (let event of events) {
    if (event.type === APP_BOXEL_ACTIVE_LLM) {
      let model = (event.content as { model?: string } | undefined)?.model;
      if (model) {
        usedLLMs.add(model);
      }
    }
  }
  return [...usedLLMs];
}

export function modelIdsOf(options: LLMOption[]): string[] {
  return [...new Set(options.map((option) => option.modelId))];
}

export function pickableModelIds(
  systemCard: SystemCard | undefined,
  usedLLMs: string[],
): string[] {
  return modelIdsOf(pickableModels(systemCard, usedLLMs));
}
