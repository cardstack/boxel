import * as vscode from 'vscode';
import { RealmAuth } from './realm-auth';

function formatSkillKey(skillId: string): string {
  return `boxel.skill.content.${skillId}`;
}

export class SkillsProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private skillLists: SkillList[] = [];

  constructor(private realmAuth: RealmAuth) {}

  getSkillInstructions(skillId: string): string | undefined {
    for (const skillList of this.skillLists) {
      const skill = skillList.skills.find((s) => s.id === skillId);
      if (skill) {
        return skill.instructions;
      }
    }
    return undefined;
  }

  getSelectedSkills(): Skill[] {
    const allSkills = this.skillLists.flatMap((skillList) => skillList.skills);
    const selectedSkills = allSkills.filter(
      (skill) => skill.checkboxState === vscode.TreeItemCheckboxState.Checked,
    );
    console.log('All skills: ', allSkills);
    console.log('Selected skills: ', selectedSkills);
    return selectedSkills;
  }

  async refresh(): Promise<void> {
    const realmUrls = await this.realmAuth.getRealmUrls();
    this.skillLists = [
      new SkillList('Base', 'https://app.boxel.ai/base/', true),
      new SkillList('Catalog', 'https://app.boxel.ai/catalog/', true),
    ];
    this.skillLists.push(...realmUrls.map((url) => new SkillList(url, url)));

    const loadingPromises = this.skillLists.map((skillList) => {
      return skillList.loadSkills(this.realmAuth);
    });
    await Promise.all(loadingPromises);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Skill): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillList): Promise<vscode.TreeItem[]> {
    if (!element) {
      //No element means we are at the root
      return Promise.resolve(this.skillLists);
    } else {
      // return children of the skill list
      return Promise.resolve(element.getChildren());
    }
  }
}

class Skill extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly instructions: string,
    public readonly id: string,
  ) {
    super(label);
    this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
  }
  getChildren(_element?: SkillList): Thenable<Skill[]> {
    return Promise.resolve([]);
  }
}

class SkillList extends vscode.TreeItem {
  skills: Skill[] = [];

  constructor(
    public readonly label: string,
    public readonly realmUrl: string,
    public readonly readOnly: boolean = false,
  ) {
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }

  getChildren(_element?: Skill): Skill[] {
    return this.skills;
  }

  async loadSkills(realmAuth: RealmAuth): Promise<void> {
    let headers: Record<string, string> = {
      Accept: 'application/vnd.card+json',
    };
    if (!this.readOnly) {
      let jwt = await realmAuth.getJWT(this.realmUrl);
      if (!jwt) {
        throw new Error(`No JWT found for realm ${this.realmUrl}`);
      }
      headers['Authorization'] = jwt;
    }

    const searchUrl = new URL('./_search', this.realmUrl);

    // Update search parameters to match the example URL
    searchUrl.searchParams.set(
      'sort[0][on][module]',
      'https://cardstack.com/base/card-api',
    );
    searchUrl.searchParams.set('sort[0][on][name]', 'CardDef');
    searchUrl.searchParams.set('sort[0][by]', 'title');
    searchUrl.searchParams.set(
      'filter[type][module]',
      'https://cardstack.com/base/skill-card',
    );
    searchUrl.searchParams.set('filter[type][name]', 'SkillCard');

    const response = await fetch(searchUrl, {
      headers,
    });

    if (!response.ok) {
      console.log(
        'Response not ok:',
        response.status,
        response.statusText,
        response.body,
      );
    }

    const data: any = await response.json();
    console.log('Skill search data:', data);

    this.skills = data.data.map((skill: any) => {
      return new Skill(
        skill.attributes.title,
        skill.attributes.instructions,
        skill.id,
      );
    });
  }
}
