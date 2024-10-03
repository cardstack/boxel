import { type SerializedState } from '@cardstack/host/services/operator-mode-state-service';

export default function (assert: Assert) {
  assert.operatorModeParametersMatch = function (
    currentURL: string,
    operatorModeState: Partial<SerializedState>,
  ) {
    let urlParameterString =
      currentURL.split('?')[1].replace(/^\/\?/, '') ?? '';
    let urlParameters = new URLSearchParams(urlParameterString);

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

        let actualStateExpectedSubset = copyPropertyValues(
          actualOperatorModeState,
          {} as Partial<SerializedState>,
          Object.keys(operatorModeState) as (keyof SerializedState)[],
        );

        assert.deepEqual(
          actualStateExpectedSubset,
          operatorModeState,
          `expected current URL ${currentURL} to match expected operator mode state properties ${encodeURIComponent(
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

// Copied from https://stackoverflow.com/a/69995318
function copyPropertyValues<T, K extends keyof T>(
  s: Pick<T, K>,
  d: T,
  ks: K[],
) {
  ks.forEach((k) => (d[k] = s[k]));
  return d;
}

declare global {
  interface Assert {
    operatorModeParametersMatch(
      currentURL: string,
      operatorModeState?: Partial<SerializedState>,
    ): void;
  }
}
