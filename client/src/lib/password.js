/**
 * Password strength and policy, shared by the sign-up and settings forms.
 *
 * This existed three times — once here in spirit, and copy-pasted into both
 * forms — so the meter could disagree with itself. It must also agree with
 * `server/utils/password.js`; `tests/password.test.js` asserts that, because a
 * meter that promises what the API rejects is worse than no meter.
 */

const LABELS = ["very weak", "weak", "fair", "strong", "excellent"];

/** @returns {{score: number, label: string}} score is 0-4 */
export function scorePassword(value = "") {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return { score, label: LABELS[score] };
}

/** Upper bound the server's validator also applies. */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * The rule the server actually enforces: 8-200 characters, a letter and a digit.
 * The upper bound matters — without it the form would happily submit a password
 * the API rejects with a validation error.
 */
export function meetsPolicy(value = "") {
  return (
    value.length >= 8 &&
    value.length <= MAX_PASSWORD_LENGTH &&
    /[a-zA-Z]/.test(value) &&
    /\d/.test(value)
  );
}

export const POLICY_HINT = "8+ characters, a letter and a number";
