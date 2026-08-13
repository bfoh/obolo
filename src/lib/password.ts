/**
 * Password rules and temporary-password generation.
 *
 * Pure and dependency-free so it can be tested directly and imported from both
 * a Server Action and a Client Component. Randomness comes from Web Crypto,
 * which exists in Node and the browser alike -- importing `node:crypto` here
 * would drag it into the client bundle.
 *
 * These rules are the app's, not the database's. Supabase Auth enforces its own
 * minimum on top; this exists so a person is told what is wrong before a round
 * trip, in a sentence rather than an error code.
 */

/** Kept in step with the "Starting password" field on the team screen. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Ambiguous characters are left out on purpose: 0/O, 1/l/I. A temporary
 * password gets read aloud across a warehouse office or copied off a phone
 * screen, and "was that a one or an ell" is a support call.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * What is wrong with a proposed password, in a sentence, or null if nothing is.
 *
 * `current` is optional: it is supplied when someone is changing their own
 * password, and omitted when an owner is setting a starting one.
 */
export function describePasswordProblem(
  next: string,
  confirm: string,
  current?: string,
): string | null {
  if (next.length === 0) return "Choose a new password.";
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // Trailing spaces survive a paste and are invisible in a password field, so
  // the sign-in that fails afterwards looks like the wrong password entirely.
  if (next !== next.trim()) return "Remove the spaces at the start or end.";
  if (next !== confirm) return "The two passwords do not match.";
  if (current !== undefined && current.length > 0 && next === current) {
    return "Choose a password you have not used here before.";
  }
  return null;
}

/**
 * A temporary password for someone else to use once.
 *
 * Three groups of four from a 55-character alphabet is about 69 bits, which is
 * far beyond anything worth guessing, while staying short enough to say out
 * loud. The dashes are for reading, and count toward the length.
 */
export function generateTemporaryPassword(): string {
  const groups = [0, 1, 2].map(() =>
    Array.from({ length: 4 }, () => ALPHABET[randomIndex(ALPHABET.length)]).join(""),
  );
  return groups.join("-");
}

/**
 * A uniformly random index below `bound`.
 *
 * Rejection sampling rather than `% bound`: 256 is not a multiple of 55, so
 * modulo would make the first characters of the alphabet measurably likelier.
 * It costs nothing here and removes the question.
 */
function randomIndex(bound: number): number {
  const limit = Math.floor(256 / bound) * bound;
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) return byte[0] % bound;
  }
}
