import { type SerializedState } from '@cardstack/host/services/operator-mode-state-service';

export default function (assert: Assert) {
  assert.operatorModeParametersMatch = function (
    currentURL: string,
    operatorModeState: SerializedState,
  ) {
    let urlParameterString = currentURL.replace(/^\/\?/, '');
    let urlParameters = new URLSearchParams(urlParameterString);

    let operatorModeEnabled = urlParameters.get('operatorModeEnabled');

    if (operatorModeEnabled !== 'true') {
      this.pushResult({
        result: false,
        actual: operatorModeEnabled,
        expected: 'true',
        message: 'expected operatorModeEnabled=true',
      });
    }

    let operatorModeStateString = urlParameters.get('operatorModeState');

    if (!operatorModeStateString) {
      this.pushResult({
        result: false,
        actual: operatorModeStateString,
        expected: 'JSON string',
        message: `in query string ${urlParameterString}, operatorModeState was '${operatorModeStateString}'`,
      });
    } else {
      let actualOperatorModeState;

      try {
        actualOperatorModeState = JSON.parse(operatorModeStateString);

        assert.deepEqual(
          actualOperatorModeState,
          operatorModeState,
          `expected current URL ${currentURL} to match operator mode state ${encodeURIComponent(
            JSON.stringify(operatorModeState),
          )}`,
        );
      } catch (error: any) {
        this.pushResult({
          result: false,
          actual: 'invalid JSON',
          expected: 'valid JSON',
          message: `operatorModeState was ${operatorModeStateString}, expected to be able to parse as JSON, got ${error}`,
        });
      }
    }
  };
}

declare global {
  interface Assert {
    operatorModeParametersMatch(
      currentURL: string,
      operatorModeState?: SerializedState,
    ): void;
  }
}
