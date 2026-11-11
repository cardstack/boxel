// TEMPORARY: skills layout fallback.
//
// The skills realm serves its skill trees at its root
// (`<realm>/boxel/SKILL.md`). Until production syncs that layout it serves them
// one level down (`<realm>/skills/boxel/SKILL.md`), and AI rooms enabled
// against that layout store skill ids in the nested form. This module lets a
// skill load from either layout. The room resource and
// `MatrixService.updateSkillsAndToolsIfNeeded` use it to write the id that
// loads back to the room, for enabled and disabled skills alike, so a room
// moves to the root form when it is opened.
//
// Remove this module, and every block marked with its name, once production
// serves the root layout and the rooms in use have rewritten their skill ids.

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

// The id to store for a skill a room holds: the id it loads from, or the
// stored id unchanged when it loads from neither layout (it then stays
// unavailable, as any skill that no longer loads does).
export async function skillIdToStore(
  store: StoreService,
  id: string,
): Promise<string> {
  if (!isMarkdownSkillId(id)) {
    return id;
  }
  return (await loadSkillWithLayoutFallback(store, id))?.id ?? id;
}
