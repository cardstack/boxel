// "Good afternoon, Ada": first name only, and no name rather than a Matrix id
// while the profile loads.
export function greetingFor(hour: number, displayName?: string): string {
  let part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  let firstName = displayName?.trim().split(/\s+/)[0];
  return firstName ? `Good ${part}, ${firstName}` : `Good ${part}`;
}
