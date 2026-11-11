// TEMPORARY: skills layout fallback.
//
// The skills realm serves its skill trees at its root
// (`<realm>/boxel/SKILL.md`). Until production syncs that layout it serves them
// one level down (`<realm>/skills/boxel/SKILL.md`), and AI rooms enabled
// against that layout store skill ids in the nested form. This module lets a
// skill load from either layout, and its two callers (the room resource and
// `MatrixService.updateSkillsAndToolsIfNeeded`) write the id that loaded back
// to the room, so the rooms in use move to the root form on their next send.
//
// Remove this module, and switch its two callers back to `loadSkillSource`,
// once production serves the root layout and the rooms in use have rewritten
// their skill ids.

import { isMarkdownSkillId, loadSkillSource } from './skill-tools';
import { skillsRealmURL } from './utils';

import type { SkillSource } from './skill-tools';
import type StoreService from '../services/store';

// Given a skill file id in either layout, returns the same file in the other
// layout, or `undefined` for an id outside the skills realm.
export function otherSkillsLayoutURL(
  id: string,
  realmURL: string = skillsRealmURL,
): string | undefined {
  if (!id.startsWith(realmURL)) {
    return undefined;
  }
  let localPath = id.slice(realmURL.length);
  if (!localPath) {
    return undefined;
  }
  return localPath.startsWith('skills/')
    ? `${realmURL}${localPath.slice('skills/'.length)}`
    : `${realmURL}skills/${localPath}`;
}

// `loadSkillSource`, retried once at the other layout for a markdown skill in
// the skills realm. Returns the skill and the id it loaded from; callers that
// persist skill ids store that id in place of the one they passed in.
export async function loadSkillWithLayoutFallback(
  store: StoreService,
  id: string,
): Promise<{ source: SkillSource; id: string } | undefined> {
  let source = await loadSkillSource(store, id);
  if (source) {
    return { source, id };
  }
  let otherId = isMarkdownSkillId(id) ? otherSkillsLayoutURL(id) : undefined;
  if (!otherId) {
    return undefined;
  }
  source = await loadSkillSource(store, otherId);
  return source ? { source, id: otherId } : undefined;
}
