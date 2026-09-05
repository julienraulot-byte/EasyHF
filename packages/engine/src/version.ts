/**
 * Engine version, stamped into every result and written to project files.
 *
 * Bump it whenever a change can alter the plan produced for an unchanged input.
 * The golden files under `test/golden/` carry it, so a bump shows up as a
 * deliberate diff across all of them rather than as a silent drift.
 */
export const ENGINE_VERSION = '0.1.0';
