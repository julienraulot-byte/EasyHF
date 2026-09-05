/**
 * Code-unit string comparison.
 *
 * `String.prototype.localeCompare` orders differently depending on the host
 * locale — a Turkish locale does not order `i` and `I` the way an English one
 * does — and link ids come from user input. Since ordering decides which link
 * the assignment search reaches first, a plan built with `localeCompare` would
 * depend on the machine that produced it. This one does not.
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
