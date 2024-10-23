import * as vscode from 'vscode';
import { RealmAuth } from './realm-auth';

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

  async refresh(): Promise<void> {
    const realmUrls = await this.realmAuth.getRealmUrls();
    this.skillLists = realmUrls.map((url) => new SkillList(url, url));
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
    public readonly skillContent: string,
    public readonly id: string,
  ) {
    super(label);
    this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
  }
  getChildren(element?: SkillList): Thenable<Skill[]> {
    return Promise.resolve([]);
  }
}

class SkillList extends vscode.TreeItem {
  skills: Skill[] = [];

  constructor(
    public readonly label: string,
    public readonly realmUrl: string,
  ) {
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }

  getChildren(_element?: Skill): Skill[] {
    return this.skills;
  }

  async loadSkills(realmAuth: RealmAuth): Promise<void> {
    const jwt = await realmAuth.getJWT(this.realmUrl);
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

    console.log('Search URL:', searchUrl);
    const response = await fetch(searchUrl, {
      headers: {
        Accept: 'application/vnd.card+json',
        Authorization: `${jwt}`,
      },
    });
    console.log('Response!');

    if (!response.ok) {
      console.log(
        'Response not ok:',
        response.status,
        response.statusText,
        response.body,
      );
    }

    const data: any = await response.json();
    console.log('Response data:', data);

    //const skills = await this.realmAuth.getSkills(jwt);
    this.skills = data.data.map((skill: any) => {
      return new Skill(
        skill.attributes.title,
        skill.attributes.instructions,
        skill.id,
      );
    });
  }
}
