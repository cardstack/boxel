/* eslint-disable no-console */

import Component from '@glimmer/component';

import Breadcrumb, { BreadcrumbSeparator } from './index.gts';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { eq } from '../../helpers/truth-helpers.ts';

export default class BreadcrumbUsage extends Component {
  @tracked selected = '';
  @action goTo(href: string) {
    this.selected = href;
    console.log(`going to link ${href}`);
  }

  <template>
    <FreestyleUsage @name='Breadcrumb (actions)'>
      <:description>
        Breadcrumbs are used to show the current page's location within a
        hierarchy.
      </:description>
      <:example>
        <Breadcrumb @kind='primary' @size='small' as |B|>
          <B
            @kind={{if
              (eq this.selected '../../')
              'primary-dark'
              'secondary-light'
            }}
            {{on 'click' (fn this.goTo '../../')}}
          >
            Home
          </B>
          <BreadcrumbSeparator @variant='caretRight' />
          <B
            @kind={{if
              (eq this.selected '../')
              'primary-dark'
              'secondary-light'
            }}
            {{on 'click' (fn this.goTo '../')}}
          >
            Tasks
          </B>
          <BreadcrumbSeparator @variant='caretRight' />
          <B
            @kind={{if
              (eq this.selected './')
              'primary-dark'
              'secondary-light'
            }}
            {{on 'click' (fn this.goTo './')}}
          >
            Active
          </B>
        </Breadcrumb>
      </:example>
    </FreestyleUsage>

    <FreestyleUsage @name='Breadcrumb (anchor)'>
      <:example>
        <Breadcrumb @kind='text-only' as |B|>
          <B
            @as='anchor'
            @href='http://localhost:4210/?s=Components&ss=%3CInputGroup%3E'
          >
            Input Group
          </B>
          <BreadcrumbSeparator @variant='slash' />
          <B
            @as='anchor'
            @href='http://localhost:4210/?s=Components&ss=%3CInput%3E'
          >
            Input
          </B>
        </Breadcrumb>
      </:example>
    </FreestyleUsage>

    <FreestyleUsage @name='Breadcrumb (with dropdown)'>
      <:example>
        <Breadcrumb @size='tall' as |B|>
          <B
            @as='anchor'
            @href='http://localhost:4210/?s=Components&ss=%3CInputGroup%3E'
          >
            Parent
          </B>
          <BreadcrumbSeparator @variant='slash' />
          <B
            @as='anchor'
            @href='http://localhost:4210/?s=Components&ss=%3CInputGroup%3E'
          >
            ...
          </B>
          <BreadcrumbSeparator @variant='slash' />
          <B
            @as='anchor'
            @href='http://localhost:4210/?s=Components&ss=%3CInput%3E'
          >
            Child
          </B>
        </Breadcrumb>
      </:example>
    </FreestyleUsage>
  </template>
}
