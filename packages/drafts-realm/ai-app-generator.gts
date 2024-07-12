import BooleanField from 'https://cardstack.com/base/boolean';
import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { cssVar } from '@cardstack/boxel-ui/helpers';

class Isolated extends Component<typeof AiAppGenerator> {
  <template>
    <section class='dashboard'>
      <header
        class='dashboard-header'
        style={{cssVar db-header-bg-color=@model.headerColor}}
      >
        <h1 class='dashboard-title'><@fields.title /></h1>
        <nav class='dashboard-nav'>
          <ul>
            <li><a class='active' href='#dashboard'>Dashboard</a></li>
            <li><a href='#requirements'>Requirements</a></li>
            <li><a href='#your-apps'>Your Apps</a></li>
            <li><a href='#sample-apps'>Sample Apps</a></li>
          </ul>
        </nav>
      </header>
      <div class='dashboard-content'>
      </div>
    </section>
    <style>
      .dashboard {
        --db-header-bg-color: var(
          --boxel-db-header-bg-color,
          var(--boxel-light)
        );
        --db-header-color: var(--boxel-db-header-color, var(--boxel-dark));
        position: relative;
        min-height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--db-bg-color, var(--boxel-light));
        color: var(--db-color, var(--boxel-dark));
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .dashboard-header {
        padding-right: var(--boxel-sp-lg);
        padding-left: var(--boxel-sp-lg);
        background-color: var(--db-header-bg-color);
        color: var(--db-header-color);
      }
      .dashboard-title {
        margin: 0;
        padding-top: var(--boxel-sp-lg);
        padding-bottom: var(--boxel-sp-xs);
        font: 900 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .dashboard-nav {
        font: var(--boxel-font-sm);
      }
      .dashboard-nav ul {
        list-style-type: none;
        margin: 0;
        display: flex;
        gap: var(--boxel-sp);
        padding: 0;
      }
      .dashboard-nav a {
        padding: var(--boxel-sp-xs) 0;
      }
      .active {
        border-bottom: 4px solid var(--db-header-color);
        font-weight: 700;
      }
      .dashboard-nav a:hover {
        color: var(--db-header-color);
        border-bottom: 4px solid var(--db-header-color);
      }
    </style>
  </template>
}

export class AiAppGenerator extends CardDef {
  @field prefersWideFormat = contains(BooleanField);
  @field headerColor = contains(StringField);
  static displayName = 'AI App Generator';

  static isolated = Isolated;

  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }







































  */
}
