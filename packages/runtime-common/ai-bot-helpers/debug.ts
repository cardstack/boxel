export function isRecognisedDebugCommand(eventBody: string) {
  return (
    eventBody.startsWith('debug:help') ||
    eventBody.startsWith('debug:prompt') ||
    eventBody.startsWith('debug:eventlist') ||
    eventBody.startsWith('debug:title:') ||
    eventBody.startsWith('debug:boom') ||
    eventBody.startsWith('debug:patch:')
  );
}
