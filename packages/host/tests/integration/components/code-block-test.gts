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

let monacoSDK = null;

let abc = class DiffEditorTestComponent extends Component {
  @tracked originalCode = 'let x = 1;\nlet y = 2;';
  @tracked modifiedCode = 'let x = 2;';

  toggleCode = () => {
    this.modifiedCode = 'let x = 2;\nlet y = 3;';
  };

  <template>
    <CodeBlock
      @monacoSDK={{monacoSDK}}
      @language={{'typescript'}}
      @originalCode={{this.originalCode}}
      @modifiedCode={{this.modifiedCode}}
      as |codeBlock|
    >
      <codeBlock.diffEditor />
    </CodeBlock>

    <button {{on 'click' this.toggleCode}}>Change modified code</button>
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

let originalCode = `import { CardDef } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

export class Basketball extends CardDef {
  static displayName = "basketball";

  static isolated = class Isolated extends Component<typeof this> {
    @tracked isAnimating = false;

    @action
    bounce() {
      this.isAnimating = true;
      setTimeout(() => {
        this.isAnimating = false;
      }, 2000);
    }

    <template>
<div class='basketball-container'>
        <h1 class='basketball-title'>Synergistic Spherical Solution</h1>
        <h2 class='basketball-subtitle'>Optimizing Athletic Performance Metrics</h2>
        <div class='basketball {{if this.isAnimating "bounce"}}'>
          <div class='lines'></div>
        </div>
        <button class='bounce-button' {{on 'click' this.bounce}}>
          Bounce!
        </button>
      </div>
      <style scoped>
        @keyframes iridescent {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }

        @keyframes bounce {
          0% { transform: translateY(-200px); }
          20% { transform: translateY(0); }
          40% { transform: translateY(-150px); }
          60% { transform: translateY(0); }
          80% { transform: translateY(-50px); }
          90% { transform: translateY(0); }
          95% { transform: translateY(-25px); }
          100% { transform: translateY(0); }
        }

        .basketball-container {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 400px;
          padding-bottom: 20px;
        }

        .basketball-title {
          margin-bottom: 20px;
        }

        .basketball {
          width: 150px;
          height: 150px;
          background: #FFC83D;
          background-image: url('https://i.imgur.com/cwXaWv6.png'), radial-gradient(
            circle at center,
            #FFED47 10%,
            #FFC83D 60%,
            #FF9B28 100%
          );
          background-size: 140%, 100%;
          background-position: center;
          background-blend-mode: multiply;
          border-radius: 50%;
          position: relative;
          box-shadow:
            inset -10px -10px 15px rgba(0, 0, 0, 0.2),
            0 0 20px rgba(255, 255, 255, 0.5);
          filter: hue-rotate(0deg);
          transform-origin: center bottom;
        }

        .bounce {
          animation: bounce 2s cubic-bezier(0.36, 0, 0.66, 1) 1 forwards;
        }

        .basketball-subtitle {
          text-align: center;
          color: #666;
          margin: 10px 0;
        }

        .bounce-button {
          position: absolute;
          bottom: 20px;
          padding: 10px 20px;
          background: #4a4a4a;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.3s;
        }

        .bounce-button:hover {
          background: #666;
        }

        .lines {
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
        }

        .lines::before, .lines::after {
          content: '';
          position: absolute;
        }

        /* Sun rays animation */
        @keyframes sunRays {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .basketball::after {
          content: '';
          position: absolute;
          top: -30px;
          left: -30px;
          right: -30px;
          bottom: -30px;
          background-image: radial-gradient(transparent 50%, transparent 55%, #FFED47 55%, #FFED47 60%, transparent 60%);
          z-index: -1;
          border-radius: 50%;
          animation: sunRays 60s linear infinite;
        }
      </style>
    </template>
  }
}`;
