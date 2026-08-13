// Mirrors the backend's PASSWORD_RULE in authController.js exactly — kept
// as individual named checks (not just one combined regex) so the UI can
// show which specific requirement is still missing, not just pass/fail.
export const PASSWORD_RULES = [
  { key: 'length',  label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper',   label: 'One uppercase letter',   test: (p) => /[A-Z]/.test(p) },
  { key: 'lower',   label: 'One lowercase letter',   test: (p) => /[a-z]/.test(p) },
  { key: 'number',  label: 'One number',             test: (p) => /\d/.test(p) },
  { key: 'special', label: 'One special character (e.g. @ # $ !)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function isPasswordComplex(password) {
  return PASSWORD_RULES.every(rule => rule.test(password || ''));
}