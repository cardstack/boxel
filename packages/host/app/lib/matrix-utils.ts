import difference from 'lodash/difference';

export interface MatrixError {
  data: {
    errcode: string;
    error: string;
  };
  httpStatus: number;
  errcode: string;
}
export const eventDebounceMs = 100;

export function isMatrixError(err: any): err is MatrixError {
  return (
    typeof err === 'object' &&
    'data' in err &&
    typeof err.data === 'object' &&
    'errcode' in err.data &&
    typeof err.data.errcode === 'string' &&
    'error' in err.data &&
    typeof err.data.error === 'string' &&
    'httpStatus' in err &&
    typeof err.httpStatus === 'number' &&
    'errcode' in err &&
    typeof err.errcode === 'string'
  );
}

export function isValidPassword(password: string): boolean {
  return /^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{8,}$/.test(password);
}

export interface InteractiveAuth {
  completed?: string[];
  session: string;
  flows: Flow[];
  error?: string;
  errcode?: string;
}

interface Flow {
  stages: string[];
}

function isFlow(flow: any): flow is Flow {
  if (
    typeof flow === 'object' &&
    'stages' in flow &&
    Array.isArray(flow.stages)
  ) {
    if (flow.stages.find((s: any) => typeof s !== 'string')) {
      return false;
    }
    return true;
  }
  return false;
}

export function isInteractiveAuth(json: any): json is InteractiveAuth {
  if (
    typeof json === 'object' &&
    'session' in json &&
    typeof json.session === 'string' &&
    'flows' in json &&
    Array.isArray(json.flows)
  ) {
    if ('error' in json && typeof json.error !== 'string') {
      return false;
    }
    if ('errcode' in json && typeof json.errcode !== 'string') {
      return false;
    }
    if ('completed' in json && !Array.isArray(json.completed)) {
      return false;
    }
    if (
      'completed' in json &&
      json.completed.length > 0 &&
      json.completed.find((c: any) => typeof c !== 'string')
    ) {
      return false;
    }

    return json.flows.every((f: any) => isFlow(f));
  }
  return false;
}

export function nextUncompletedStage(authFlow: InteractiveAuth) {
  if (authFlow.flows.length === 0) {
    throw new Error(
      `Completed all interactive auth stages but encountered unsuccessful interactive auth response: ${JSON.stringify(
        authFlow,
        null,
        2,
      )}`,
    );
  }
  let remainingStages = difference(
    authFlow.flows[0].stages,
    authFlow.completed ?? [],
  );
  if (remainingStages.length === 0) {
    throw new Error(
      `Completed all interactive auth stages but encountered unsuccessful interactive auth response: ${JSON.stringify(
        authFlow,
        null,
        2,
      )}`,
    );
  }
  return remainingStages[0];
}
