// Pretui — toolIcon: the icon a tool call is drawn with, from boxel-icons, by the tool's name or verb.
import type { ComponentLike } from '@glint/template';
import BookOpen from '@cardstack/boxel-icons/book-open';
import Brain from '@cardstack/boxel-icons/brain';
import Code from '@cardstack/boxel-icons/code';
import Copy from '@cardstack/boxel-icons/copy';
import Database from '@cardstack/boxel-icons/database';
import Download from '@cardstack/boxel-icons/download';
import FileText from '@cardstack/boxel-icons/file-text';
import Globe from '@cardstack/boxel-icons/globe';
import HelpCircle from '@cardstack/boxel-icons/help-circle';
import ListChecks from '@cardstack/boxel-icons/list-checks';
import Pencil from '@cardstack/boxel-icons/pencil';
import Photo from '@cardstack/boxel-icons/photo';
import Search from '@cardstack/boxel-icons/search';
import ShieldCheck from '@cardstack/boxel-icons/shield-check';
import Sparkles from '@cardstack/boxel-icons/sparkles';
import Telescope from '@cardstack/boxel-icons/telescope';
import Terminal from '@cardstack/boxel-icons/terminal';
import Trash from '@cardstack/boxel-icons/trash-2';
import Upload from '@cardstack/boxel-icons/upload';
import Wrench from '@cardstack/boxel-icons/wrench';

export type ToolIcon = ComponentLike<{ Element: SVGSVGElement }>;

// Words in a tool's name or verb, first match wins: the more particular
// kinds before the general ones ('web-search' is a search, 'readUrl' a web
// read, 'read' a file)
const KINDS: [RegExp, ToolIcon][] = [
  [new RegExp('research|investigat', 'i'), Telescope as ToolIcon],
  [new RegExp('url|web|fetch|browse|http', 'i'), Globe as ToolIcon],
  [new RegExp('search|find|query|grep|glob|lookup', 'i'), Search as ToolIcon],
  [
    new RegExp('check|lint|test|verify|correct|validat', 'i'),
    ShieldCheck as ToolIcon,
  ],
  [new RegExp('delete|remove|trash|drop', 'i'), Trash as ToolIcon],
  [new RegExp('copy|duplicat|clone', 'i'), Copy as ToolIcon],
  [
    new RegExp('edit|write|patch|update|replace|mark|set|rename', 'i'),
    Pencil as ToolIcon,
  ],
  [new RegExp('script|run-realm-code|code|eval|exec', 'i'), Code as ToolIcon],
  [new RegExp('shell|bash|terminal|command', 'i'), Terminal as ToolIcon],
  [new RegExp('skill|read-realm|doc|guide|learn', 'i'), BookOpen as ToolIcon],
  [new RegExp('read|open|view|load|file', 'i'), FileText as ToolIcon],
  [new RegExp('upload|attach|send|publish|ship', 'i'), Upload as ToolIcon],
  [new RegExp('download|export|save', 'i'), Download as ToolIcon],
  [new RegExp('image|photo|picture|draw', 'i'), Photo as ToolIcon],
  [new RegExp('generat|create|make|compose|draft', 'i'), Sparkles as ToolIcon],
  [new RegExp('index|database|table|record', 'i'), Database as ToolIcon],
  [new RegExp('plan|todo|task|step', 'i'), ListChecks as ToolIcon],
  [new RegExp('ask|question|choose|pick', 'i'), HelpCircle as ToolIcon],
  [new RegExp('think|reason|reflect', 'i'), Brain as ToolIcon],
];

/** the icon for a tool, by its name first, then its verb; a wrench for a
 * tool nothing names */
export function toolIcon(name?: string, verb?: string): ToolIcon {
  for (let word of [name, verb]) {
    if (!word) {
      continue;
    }
    let hit = KINDS.find(([re]) => re.test(word));
    if (hit) {
      return hit[1];
    }
  }
  return Wrench as ToolIcon;
}
