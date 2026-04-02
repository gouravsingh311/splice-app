const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAuthMessage,
  buildOtpStatusMessage,
  hasValidationErrors,
  validateLoginForm,
  validateRegisterForm,
  validateResetForm,
} = require("../src/renderer/core/auth/state.js");

test("login form validation flags missing fields", () => {
  const errors = validateLoginForm({
    email: "",
    password: "",
  });

  assert.equal(hasValidationErrors(errors), true);
  assert.equal(errors.email, "Email is required.");
  assert.equal(errors.password, "Password is required.");
});

test("register form validation enforces password confirmation and minimum length", () => {
  const errors = validateRegisterForm({
    email: "creator@example.com",
    password: "short",
    confirmPassword: "shorter",
  });

  assert.equal(hasValidationErrors(errors), true);
  assert.match(errors.password, /at least 12 characters/);
  assert.equal(errors.confirmPassword, "Passwords do not match.");
});

test("reset form validation requires OTP and valid passwords", () => {
  const errors = validateResetForm({
    email: "creator@example.com",
    otpCode: "12",
    newPassword: "WeakPass",
    confirmPassword: "WeakPass",
  });

  assert.equal(hasValidationErrors(errors), true);
  assert.equal(errors.otpCode, "OTP code must be 4-8 digits.");
  assert.match(errors.newPassword, /at least 12 characters/);
});

test("OTP status helper renders both generic and challenge-based messaging", () => {
  assert.equal(
    buildOtpStatusMessage({
      challengeId: null,
      expiresAt: null,
      cooldownSeconds: 0,
    }),
    "If the account exists, a reset OTP has been sent."
  );

  assert.equal(
    buildOtpStatusMessage({
      challengeId: "otp_123",
      expiresAt: "2026-02-25T00:10:00.000Z",
      cooldownSeconds: 45,
    }),
    "OTP sent. Enter the code to continue. Cooldown: 45s."
  );
});

test("auth message helper maps lockout and rate-limit states", () => {
  const lockout = buildAuthMessage({
    code: "AUTH_LOCKED",
    reason: "AUTH_SERVICE_ERROR:423",
    message: "Account temporarily locked",
  });
  assert.equal(lockout.lockout, true);
  assert.equal(lockout.tone, "error");
  assert.match(lockout.message, /temporarily locked/);

  const rateLimited = buildAuthMessage({
    code: "AUTH_RATE_LIMITED",
    reason: "OTP send is cooling down",
    message: "OTP send is cooling down",
  });
  assert.equal(rateLimited.lockout, false);
  assert.equal(rateLimited.tone, "warning");
  assert.match(rateLimited.message, /cooldown/);
});
