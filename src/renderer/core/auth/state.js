(function initAuthUiState(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope && typeof globalScope === "object") {
    globalScope.authUiState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const OTP_PATTERN = /^\d{4,8}$/;
  const MIN_PASSWORD_LENGTH = 12;

  function validateEmail(email) {
    if (typeof email !== "string" || email.trim().length === 0) {
      return "Email is required.";
    }

    if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) {
      return "Enter a valid email address.";
    }

    return null;
  }

  function validatePassword(password, label = "Password") {
    if (typeof password !== "string" || password.length === 0) {
      return `${label} is required.`;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return `${label} must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    return null;
  }

  function validateOtpCode(otpCode) {
    if (typeof otpCode !== "string" || otpCode.trim().length === 0) {
      return "OTP code is required.";
    }

    if (!OTP_PATTERN.test(otpCode.trim())) {
      return "OTP code must be 4-8 digits.";
    }

    return null;
  }

  function hasValidationErrors(errors) {
    return Object.values(errors).some((value) => typeof value === "string" && value.length > 0);
  }

  function validateLoginForm(values) {
    const errors = {
      email: validateEmail(values.email),
      password: values.password ? null : "Password is required.",
    };

    return errors;
  }

  function validateRegisterForm(values) {
    const errors = {
      email: validateEmail(values.email),
      password: validatePassword(values.password),
      confirmPassword: null,
    };

    if (values.password && values.confirmPassword && values.password !== values.confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (!values.confirmPassword) {
      errors.confirmPassword = "Confirm password is required.";
    }

    return errors;
  }

  function validateForgotForm(values) {
    return {
      email: validateEmail(values.email),
    };
  }

  function validateResetForm(values) {
    const errors = {
      email: validateEmail(values.email),
      otpCode: validateOtpCode(values.otpCode),
      newPassword: validatePassword(values.newPassword, "New password"),
      confirmPassword: null,
    };

    if (!values.confirmPassword) {
      errors.confirmPassword = "Confirm new password is required.";
    } else if (values.newPassword !== values.confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    return errors;
  }

  function buildAuthMessage(error, fallbackMessage = "Request failed. Please try again.") {
    const code = String(error?.code || "").trim();
    const backendMessage = String(error?.message || "").trim();
    const reason = String(error?.reason || "").trim();

    if (code === "AUTH_LOCKED") {
      return {
        tone: "error",
        lockout: true,
        message:
          "Account temporarily locked after repeated failures. Wait 15 minutes and try again.",
      };
    }

    if (code === "AUTH_RATE_LIMITED") {
      const isCooldown = reason.includes("cooling");
      return {
        tone: "warning",
        lockout: false,
        message: isCooldown
          ? "OTP request cooldown active. Wait before requesting another code."
          : "Rate limit reached. Please wait and retry.",
      };
    }

    if (code === "VALIDATION_ERROR") {
      return {
        tone: "warning",
        lockout: false,
        message: backendMessage || "Input validation failed. Check your entries.",
      };
    }

    if (code === "AUTH_UNAUTHORIZED" || code === "AUTH_FORBIDDEN") {
      return {
        tone: "error",
        lockout: false,
        message: backendMessage || "Credentials are invalid or no longer authorized.",
      };
    }

    return {
      tone: "error",
      lockout: false,
      message: backendMessage || fallbackMessage,
    };
  }

  function buildOtpStatusMessage(otpData) {
    if (!otpData || typeof otpData !== "object") {
      return null;
    }

    if (otpData.challengeId === null) {
      return "If the account exists, a reset OTP has been sent.";
    }

    if (typeof otpData.challengeId !== "string" || otpData.challengeId.length === 0) {
      return null;
    }

    const cooldown =
      Number.isInteger(otpData.cooldownSeconds) && otpData.cooldownSeconds > 0
        ? `Cooldown: ${otpData.cooldownSeconds}s.`
        : "Cooldown: none.";
    return `OTP sent. Enter the code to continue. ${cooldown}`;
  }

  return {
    MIN_PASSWORD_LENGTH,
    buildAuthMessage,
    buildOtpStatusMessage,
    hasValidationErrors,
    validateForgotForm,
    validateLoginForm,
    validateRegisterForm,
    validateResetForm,
  };
});
