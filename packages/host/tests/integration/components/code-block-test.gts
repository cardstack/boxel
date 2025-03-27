import { RenderingTestContext, render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import FormattedMessage from '@cardstack/host/components/ai-assistant/formatted-message';

import MonacoService from '@cardstack/host/services/monaco-service';

import { setupRenderingTest } from '../../helpers/setup';
import CodeBlock from '@cardstack/host/components/ai-assistant/code-block';
import { tracked } from '@glimmer/tracking';
import Component from '@glimmer/component';
import { renderComponent } from '../../helpers/render-component';
import { on } from '@ember/modifier';
import ApplySearchReplaceBlockCommand from '@cardstack/host/commands/apply-search-replace-block';
import { lookupService } from '../../helpers';
import CommandService from '@cardstack/host/services/command-service';
import {
  parseCodeContent,
  parseSearchReplace,
} from '@cardstack/host/lib/search-replace-block-parsing';

let monacoSDK = null;

let abc = class DiffEditorTestComponent extends Component {
  @tracked originalCode = null;
  @tracked modifiedCode = null;
  @tracked diffIndex = 0;

  applyCodePatch = async () => {
    let searchReplaceBlock;
    if (this.diffIndex === 0) {
      searchReplaceBlock = srblock_0;
    } else if (this.diffIndex === 1) {
      searchReplaceBlock = srblock_final;
    } else {
      searchReplaceBlock = srblock_0;
    }

    let codeContent = parseSearchReplace(searchReplaceBlock);
    let newSrBlock = `<<<<<<< SEARCH
${codeContent.searchContent || ''}
=======
${codeContent.replaceContent || ''}
>>>>>>> REPLACE`;

    let commandService = lookupService<CommandService>('command-service');
    let applyCommand = new ApplySearchReplaceBlockCommand(
      commandService.commandContext,
    );
    let result = await applyCommand.execute({
      fileContent: originalCode,
      codeBlock: newSrBlock,
    });

    this.originalCode = originalCode;
    this.modifiedCode = result.resultContent;
    this.diffIndex++;
  };

  <template>
    {{#if this.originalCode}}
      <CodeBlock
        @monacoSDK={{monacoSDK}}
        @language={{'typescript'}}
        @originalCode={{this.originalCode}}
        @modifiedCode={{this.modifiedCode}}
        as |codeBlock|
      >
        <codeBlock.diffEditor />
      </CodeBlock>
    {{/if}}

    <button {{on 'click' this.applyCodePatch}}>Simulate stream step</button>
  </template>
};

module('Integration | Component | FormattedMessage', function (hooks) {
  setupRenderingTest(hooks);

  let monacoService: MonacoService;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    monacoService = this.owner.lookup(
      'service:monaco-service',
    ) as MonacoService;
  });

  // async function renderCodeBlock(testScenario: any) {
  //   let monacoSDK = await monacoService.getMonacoContext();

  //   await render(<template>
  //     <CodeBlock
  //       @monacoSDK={{monacoSDK}}
  //       @language={{testScenario.language}}
  //       @originalCode={{this.abc}}
  //       @modifiedCode={{testScenario.modifiedCode}}
  //       as |codeBlock|
  //     >
  //       <codeBlock.diffEditor />
  //     </CodeBlock>
  //   </template>);
  // }

  test('it renders a diff editor', async function (assert) {
    // await renderCodeBlock({
    //   language: 'typescript',
    //   originalCode: `let x = 1;`,
    //   modifiedCode: `let x = 2;`,
    // });

    monacoSDK = await monacoService.getMonacoContext();

    await renderComponent(abc);

    await this.pauseTest();

    assert.dom('.code-block').exists();
  });
});

let srblock_0 = `// File url: paste.txt
<<<<<<< SEARCH
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
=======
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>`;

let srblock_final = `// File url: paste.txt
<<<<<<< SEARCH
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
=======
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>

            <div class='detail-item'>
              <span class='label'>Where:</span>
              <span class='value'>123 Party Lane, Celebration City</span>
            </div>
          </div>

          <div class='rsvp-section'>
>>>>>>> REPLACE`;

let originalCode = `import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
export class BdEventInvite extends CardDef {
  static displayName = "bd-event-invite";

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='birthday-invite'>
        <div class='invite-header'>
          <h1 class='title'>Birthday Party Invitation!</h1>
          <div class='balloon-decoration'>🎈</div>
        </div>

        <div class='invite-content'>
          <p class='greeting'>You're invited to celebrate with us!</p>

          <div class='event-details'>
            <div class='detail-item'>
              <span class='label'>When:</span>
              <span class='value'>Saturday, December 16th at 3:00 PM</span>
            </div>

            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
            <p class='rsvp-text'>Please RSVP by December 10th</p>
            <button class='rsvp-button'>RSVP Now</button>
          </div>
        </div>
      </div>

      <style scoped>
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        @keyframes rainbow {
          0% { color: red; }
          14% { color: orange; }
          28% { color: yellow; }
          42% { color: green; }
          56% { color: blue; }
          70% { color: indigo; }
          84% { color: violet; }
          100% { color: red; }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .birthday-invite {
          background: linear-gradient(to right, #0a192f, #172a45);
          border: 2px solid #64ffda;
          padding: 2rem;
          max-width: 800px;
          margin: 2rem auto;
          position: relative;
          box-shadow: 0 0 20px rgba(100, 255, 218, 0.2);
        }

        .invite-header {
          text-align: center;
          margin-bottom: 2rem;
          position: relative;
          border-bottom: 1px solid rgba(100, 255, 218, 0.3);
          padding-bottom: 1rem;
        }

        .title {
          color: #64ffda;
          font-size: 3rem;
          margin: 0;
          font-family: 'Space Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          animation: glow 2s ease-in-out infinite alternate;
        }

        .balloon-decoration {
          font-size: 4rem;
          position: absolute;
          top: -1rem;
          right: 1rem;
          animation: spin 4s linear infinite;
        }

        .invite-content {
          background-color: #000;
          color: #fff;
          padding: 2rem;
          border: 3px dashed #ff0;
          background-image: url('https://web.archive.org/web/19961219003255im_/http://geocities.com/images/stardust.gif');
        }

        .greeting {
          text-align: center;
          font-size: 2rem;
          color: #0f0;
          margin-bottom: 2rem;
          animation: blink 1s step-end infinite;
        }

        .event-details {
          margin: 2rem 0;
          background: rgba(0, 0, 0, 0.8);
          padding: 1rem;
          border: 2px solid #ff0;
        }

        .detail-item {
          margin: 1rem 0;
          display: flex;
          gap: 1rem;
          animation: marquee 20s linear infinite;
        }

        .label {
          font-weight: bold;
          color: #f0f;
          min-width: 60px;
          text-transform: uppercase;
        }

        .value {
          color: #0ff;
          text-shadow: 1px 1px #f0f;
        }

        .rsvp-section {
          text-align: center;
          margin-top: 2rem;
        }

        .rsvp-text {
          color: #ff0;
          margin-bottom: 1rem;
          font-size: 1.5rem;
          animation: blink 2s step-end infinite;
        }

        .rsvp-button {
          background: linear-gradient(90deg, #f0f, #ff0);
          color: #000;
          border: 3px outset #f0f;
          padding: 1rem 3rem;
          font-size: 1.5rem;
          cursor: pointer;
          font-family: 'Comic Sans MS', cursive;
          text-transform: uppercase;
          animation: rainbow 3s linear infinite;
        }

        .rsvp-button:hover {
          background: linear-gradient(90deg, #ff0, #f0f);
          border-style: inset;
        }
      </style>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
}`;
