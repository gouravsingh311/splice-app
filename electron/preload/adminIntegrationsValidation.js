function assertAdminIntegrationRequest(channel, payload, context) {
  const { IPC_CHANNELS, isNonEmptyString } = context;

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST) {
    const validProvider =
      payload.provider === "dropbox" || payload.provider === "airtable" || payload.provider === "smtp";
    if (!validProvider || !isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: provider and admin actor context are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "keyRef") &&
      payload.keyRef !== null &&
      !isNonEmptyString(payload.keyRef)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: keyRef must be non-empty string|null`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE) {
    const validProvider =
      payload.provider === "dropbox" || payload.provider === "airtable" || payload.provider === "smtp";
    if (
      !validProvider ||
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.reason) ||
      !isNonEmptyString(payload.confirmation)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: provider/admin actor context/reason/confirmation are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "keyRef") &&
      payload.keyRef !== null &&
      payload.keyRef !== undefined &&
      !isNonEmptyString(payload.keyRef)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: keyRef must be non-empty string|null`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.apiKey)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context and apiKey are required`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_SMTP_CONFIGURE) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.host) ||
      !Number.isInteger(payload.port) ||
      payload.port < 1 ||
      payload.port > 65535
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context, host and valid port are required`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.refreshToken)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context and refreshToken are required`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.appKey) ||
      !isNonEmptyString(payload.appSecret)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context, appKey and appSecret are required`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "appKey") &&
      payload.appKey !== null &&
      payload.appKey !== undefined &&
      !isNonEmptyString(payload.appKey)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: appKey must be non-empty string|null`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.authCode)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context and authCode are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "appKey") &&
      payload.appKey !== null &&
      payload.appKey !== undefined &&
      !isNonEmptyString(payload.appKey)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: appKey must be non-empty string|null`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "appSecret") &&
      payload.appSecret !== null &&
      payload.appSecret !== undefined &&
      !isNonEmptyString(payload.appSecret)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: appSecret must be non-empty string|null`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "redirectUri") &&
      payload.redirectUri !== null &&
      payload.redirectUri !== undefined &&
      !isNonEmptyString(payload.redirectUri)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: redirectUri must be non-empty string|null`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START) {
    if (!isNonEmptyString(payload.actorId) || payload.actorRole !== "admin") {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actorId/actorRole are required`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "appKey") &&
      payload.appKey !== null &&
      payload.appKey !== undefined &&
      !isNonEmptyString(payload.appKey)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: appKey must be non-empty string|null`
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, "appSecret") &&
      payload.appSecret !== null &&
      payload.appSecret !== undefined &&
      !isNonEmptyString(payload.appSecret)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: appSecret must be non-empty string|null`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS) {
    if (
      !isNonEmptyString(payload.actorId) ||
      payload.actorRole !== "admin" ||
      !isNonEmptyString(payload.sessionId)
    ) {
      throw new Error(
        `Preload request validation failed for ${channel}: admin actor context and sessionId are required`
      );
    }
    return true;
  }

  return false;
}

function assertAdminIntegrationSuccess(channel, response, context) {
  const { IPC_CHANNELS, isNonEmptyString, isIsoTimestamp } = context;

  if (
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST ||
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST
  ) {
    const integrations =
      channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST
        ? response.data.integrations
        : [response.data];
    if (!Array.isArray(integrations)) {
      throw new Error(`Preload response validation failed for ${channel}: integrations must be array`);
    }
    for (const integration of integrations) {
      const hasValidError =
        integration.error === null ||
        integration.error === undefined ||
        isNonEmptyString(integration.error);
      const hasValidErrorCode =
        integration.errorCode === null ||
        integration.errorCode === undefined ||
        isNonEmptyString(integration.errorCode);
      const hasValidFailureContext =
        integration.lastFailureContext === null ||
        integration.lastFailureContext === undefined ||
        isNonEmptyString(integration.lastFailureContext);
      const hasValidRotatedAt =
        integration.lastRotatedAt === null ||
        integration.lastRotatedAt === undefined ||
        isIsoTimestamp(integration.lastRotatedAt);
      const validStatusClass =
        integration.statusClass === "healthy" ||
        integration.statusClass === "degraded" ||
        integration.statusClass === "unhealthy" ||
        integration.statusClass === "unconfigured" ||
        integration.statusClass === "unavailable";
      const validRecommendedAction =
        integration.recommendedAction === "none" ||
        integration.recommendedAction === "run_connection_test" ||
        integration.recommendedAction === "rotate_credentials" ||
        integration.recommendedAction === "verify_provider_configuration";
      if (
        !isNonEmptyString(integration.provider) ||
        typeof integration.ok !== "boolean" ||
        !Number.isInteger(integration.latencyMs) ||
        integration.latencyMs < 0 ||
        !validStatusClass ||
        !validRecommendedAction ||
        !isNonEmptyString(integration.statusCopy) ||
        !isNonEmptyString(integration.credentialStatus) ||
        !isIsoTimestamp(integration.lastCheckedAt) ||
        !hasValidErrorCode ||
        !hasValidRotatedAt ||
        !hasValidFailureContext ||
        !hasValidError
      ) {
        throw new Error(
          `Preload response validation failed for ${channel}: invalid integration health payload`
        );
      }
    }
    return true;
  }

  if (
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE ||
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_SMTP_CONFIGURE ||
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE ||
    channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE
  ) {
    const validProvider =
      response.data.provider === "dropbox" ||
      response.data.provider === "airtable" ||
      response.data.provider === "smtp";
    if (
      !validProvider ||
      !isNonEmptyString(response.data.status) ||
      !isIsoTimestamp(response.data.configuredAt)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid integration configure payload`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE) {
    if (
      !isNonEmptyString(response.data.provider) ||
      !isNonEmptyString(response.data.status) ||
      !isIsoTimestamp(response.data.rotatedAt) ||
      !isNonEmptyString(response.data.keyRef)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid integration rotate payload`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET) {
    const statusValid =
      response.data.status === "READY" ||
      response.data.status === "NOT_CONFIGURED" ||
      response.data.status === "INVALID_TOKEN";
    const validHasAppCredentials =
      response.data.hasAppCredentials === undefined ||
      typeof response.data.hasAppCredentials === "boolean";
    const validAuthorizeUrl =
      response.data.authorizeUrl === null ||
      response.data.authorizeUrl === undefined ||
      isNonEmptyString(response.data.authorizeUrl);
    if (
      response.data.provider !== "dropbox" ||
      !statusValid ||
      !isNonEmptyString(response.data.message) ||
      !validHasAppCredentials ||
      !validAuthorizeUrl
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox readiness payload`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START) {
    if (response.data.provider !== "dropbox" || !isNonEmptyString(response.data.authorizeUrl)) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox OAuth start payload`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE) {
    const validAccountId =
      response.data.accountId === null ||
      response.data.accountId === undefined ||
      isNonEmptyString(response.data.accountId);
    if (
      response.data.provider !== "dropbox" ||
      !isNonEmptyString(response.data.status) ||
      !validAccountId ||
      !isIsoTimestamp(response.data.configuredAt)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox OAuth complete payload`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START) {
    if (
      !isNonEmptyString(response.data.sessionId) ||
      response.data.status !== "pending" ||
      !isNonEmptyString(response.data.authorizeUrl) ||
      !isIsoTimestamp(response.data.startedAt)
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox desktop OAuth start payload`
      );
    }
    return true;
  }

  if (channel === IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS) {
    const validStatus =
      response.data.status === "pending" ||
      response.data.status === "completed" ||
      response.data.status === "failed" ||
      response.data.status === "expired";
    const validAccountId =
      response.data.accountId === null ||
      response.data.accountId === undefined ||
      isNonEmptyString(response.data.accountId);
    const validConfiguredAt =
      response.data.configuredAt === null ||
      response.data.configuredAt === undefined ||
      isIsoTimestamp(response.data.configuredAt);
    if (
      !isNonEmptyString(response.data.sessionId) ||
      !validStatus ||
      !isNonEmptyString(response.data.message) ||
      !validAccountId ||
      !validConfiguredAt
    ) {
      throw new Error(
        `Preload response validation failed for ${channel}: invalid Dropbox desktop OAuth status payload`
      );
    }
    return true;
  }

  return false;
}

module.exports = {
  assertAdminIntegrationRequest,
  assertAdminIntegrationSuccess,
};
