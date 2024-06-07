import { type SerializedState } from '@cardstack/host/services/operator-mode-state-service';

export default function (assert: Assert) {
  assert.operatorModeParametersMatch = function (
    currentURL: string,
    operatorModeState: Partial<SerializedState>,
  ) {
    let urlParameterString =
      currentURL.split('?')[1].replace(/^\/\?/, '') ?? '';
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
      let actualOperatorModeState: Partial<SerializedState> = {};

      try {
        actualOperatorModeState = JSON.parse(
          operatorModeStateString,
        ) as Partial<SerializedState>;

        let actualStateExpectedSubset = Object.keys(operatorModeState).reduce(
          (subset, key) => {
            subset[key] = actualOperatorModeState[key];
            return subset;
          },
          {} as Partial<SerializedState>,
        );

        assert.deepEqual(
          actualStateExpectedSubset,
          operatorModeState,
          `expected current URL ${currentURL} to match expected operator mode state ${encodeURIComponent(
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
      operatorModeState?: Partial<SerializedState>,
    ): void;
  }
}
