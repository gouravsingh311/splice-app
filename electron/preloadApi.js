const {
  IPC_CHANNELS,
  formatZodIssues,
  getContract,
} = require("./ipc/contracts");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  Object.keys(value).forEach((key) => {
    deepFreeze(value[key]);
  });

  return value;
}

function createContractInvoker(invoke) {
  if (typeof invoke !== "function") {
    throw new Error("A valid invoke function is required");
  }

  return async function invokeChannel(channel, payload) {
    const contract = getContract(channel);
    if (!contract) {
      throw new Error(`Unknown IPC contract: ${channel}`);
    }

    const parsedRequest = contract.requestSchema.safeParse(payload ?? {});
    if (!parsedRequest.success) {
      throw new Error(
        `Preload request validation failed for ${channel}: ${formatZodIssues(parsedRequest.error.issues)}`
      );
    }

    const rawResponse = await invoke(channel, parsedRequest.data);
    const parsedResponse = contract.responseSchema.safeParse(rawResponse);

    if (!parsedResponse.success) {
      throw new Error(
        `Preload response validation failed for ${channel}: ${formatZodIssues(parsedResponse.error.issues)}`
      );
    }

    return parsedResponse.data;
  };
}

function createPreloadApi(options = {}) {
  const invokeChannel = createContractInvoker(options.invoke);
  const versions = options.versions || {};
  const runtime = options.runtime || {};

  const api = {
    system: {
      versions: {
        electron: versions.electron || "unknown",
        chrome: versions.chrome || "unknown",
      },
      runtime: {
        environment: runtime.environment || "local",
        healthPort: Number.isInteger(runtime.healthPort) ? runtime.healthPort : 4815,
        bypassAuth: runtime.bypassAuth === true,
      },
    },
    auth: {
      getSession: (payload = {}) => invokeChannel(IPC_CHANNELS.AUTH_GET_SESSION, payload),
      currentRole: async () => {
        const response = await invokeChannel(IPC_CHANNELS.AUTH_GET_SESSION, {
          includePermissions: false,
        });
        if (!response.ok || !response.data || !response.data.actor) {
          return null;
        }
        const roles = Array.isArray(response.data.actor.roles) ? response.data.actor.roles : [];
        return roles.length > 0 ? roles[0] : null;
      },
      login: (payload) => invokeChannel(IPC_CHANNELS.AUTH_LOGIN, payload),
      register: (payload) => invokeChannel(IPC_CHANNELS.AUTH_REGISTER, payload),
      sendOtp: (payload) => invokeChannel(IPC_CHANNELS.AUTH_OTP_SEND, payload),
      verifyOtp: (payload) => invokeChannel(IPC_CHANNELS.AUTH_OTP_VERIFY, payload),
      forgotPassword: (payload) => invokeChannel(IPC_CHANNELS.AUTH_FORGOT_PASSWORD, payload),
      resetPassword: (payload) => invokeChannel(IPC_CHANNELS.AUTH_RESET_PASSWORD, payload),
    },
    qc: {
      evaluatePack: (payload) => invokeChannel(IPC_CHANNELS.QC_EVALUATE_PACK, payload),
      listRules: (payload = {}) => invokeChannel(IPC_CHANNELS.QC_LIST_RULES, payload),
      getResults: (payload) => invokeChannel(IPC_CHANNELS.QC_RESULTS_GET, payload),
      exportReport: (payload) => invokeChannel(IPC_CHANNELS.QC_REPORT_EXPORT, payload),
    },
    notifications: {
      list: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_LIST, payload),
      markRead: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_MARK_READ, payload),
      markAllRead: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_MARK_ALL_READ, payload),
      retry: (payload) => invokeChannel(IPC_CHANNELS.NOTIFICATIONS_RETRY, payload),
    },
    creator: {
      profile: {
        get: (payload) => invokeChannel(IPC_CHANNELS.CREATOR_PROFILE_GET, payload),
        put: (payload) => invokeChannel(IPC_CHANNELS.CREATOR_PROFILE_PUT, payload),
      },
    },
    submissions: {
      createDraft: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_DRAFT, payload),
      updateMetadata: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_METADATA, payload),
      list: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_LIST, payload),
      timeline: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_TIMELINE, payload),
      syncAirtable: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_AIRTABLE_SYNC, payload),
      resetAirtable: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_AIRTABLE_RESET, payload),
      transition: (payload) => invokeChannel(IPC_CHANNELS.SUBMISSION_TRANSITION, payload),
    },
    intake: {
      selectFolder: () => invokeChannel(IPC_CHANNELS.INTAKE_FOLDER_SELECT, {}),
      startSession: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_SESSION_START, payload),
      putManifest: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_MANIFEST_PUT, payload),
      createHandoff: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_HANDOFF_CREATE, payload),
      getHandoffStatus: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_HANDOFF_STATUS_GET, payload),
      controlHandoff: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_HANDOFF_CONTROL, payload),
      lockSubmissionFiles: (payload) => invokeChannel(IPC_CHANNELS.INTAKE_LOCK, payload),
    },
    review: {
      listQueue: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_QUEUE_LIST, payload),
      getSubmission: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_SUBMISSION_GET, payload),
      approve: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_APPROVE, payload),
      reject: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_REJECT, payload),
      addTag: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_TAG_ADD, payload),
      addFlag: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_FLAG_ADD, payload),
      reopen: (payload) => invokeChannel(IPC_CHANNELS.REVIEW_REOPEN, payload),
    },
    admin: {
      configs: {
        list: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_LIST, payload),
        createDraft: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_DRAFT, payload),
        publish: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_PUBLISH, payload),
        rollback: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_CONFIGS_ROLLBACK, payload),
      },
      integrations: {
        listHealth: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_HEALTH_LIST, payload),
        test: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_TEST, payload),
        rotate: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_ROTATE, payload),
        configureAirtable: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_AIRTABLE_CONFIGURE, payload),
        configureSmtp: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_SMTP_CONFIGURE, payload),
        updateDropboxTokens: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_TOKENS_UPDATE, payload),
        configureDropboxApp: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_INTEGRATIONS_DROPBOX_APP_CONFIGURE, payload),
        getDropboxReadiness: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_READINESS_GET, payload),
        startDropboxOauth: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_START, payload),
        completeDropboxOauth: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_COMPLETE, payload),
        startDropboxOauthDesktop: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_START, payload),
        getDropboxOauthDesktopStatus: (payload) =>
          invokeChannel(IPC_CHANNELS.ADMIN_DROPBOX_OAUTH_DESKTOP_STATUS, payload),
      },
      ops: {
        listHistory: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_OPS_HISTORY_LIST, payload),
      },
      qcPolicy: {
        get: (payload = { actorId: "desktop-local-admin", actorRole: "admin" }) =>
          invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_GET, payload),
        update: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE, payload),
        getActive: (payload = { actorId: "desktop-local-admin", actorRole: "admin" }) =>
          invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_GET, payload),
        updateActive: (payload) => invokeChannel(IPC_CHANNELS.ADMIN_QC_POLICY_UPDATE, payload),
      },
    },
    jobs: {
      enqueue: (payload) => invokeChannel(IPC_CHANNELS.JOBS_ENQUEUE, payload),
      get: (payload) => invokeChannel(IPC_CHANNELS.JOBS_GET, payload),
      replay: (payload) => invokeChannel(IPC_CHANNELS.JOBS_REPLAY, payload),
    },
    scheduling: {
      resolve: (payload) => invokeChannel(IPC_CHANNELS.SCHEDULING_RESOLVE, payload),
      override: (payload) => invokeChannel(IPC_CHANNELS.SCHEDULING_OVERRIDE, payload),
      triggerRelease: (payload) =>
        invokeChannel(IPC_CHANNELS.SCHEDULING_TRIGGER_RELEASE, payload),
    },
    observability: {
      getMetrics: () => invokeChannel(IPC_CHANNELS.OBSERVABILITY_METRICS_GET, {}),
      annotateIncident: (payload) =>
        invokeChannel(IPC_CHANNELS.OBSERVABILITY_INCIDENTS_ANNOTATE, payload),
    },
    desktop: {
      verifySecurityConfig: () => invokeChannel(IPC_CHANNELS.DESKTOP_VERIFY_SECURITY, {}),
    },
    audit: {
      listSecurityEvents: (payload = {}) =>
        invokeChannel(IPC_CHANNELS.AUDIT_LIST_SECURITY_EVENTS, payload),
      listEvents: (payload) => invokeChannel(IPC_CHANNELS.AUDIT_EVENTS_LIST, payload),
      exportEvents: (payload) => invokeChannel(IPC_CHANNELS.AUDIT_EVENTS_EXPORT, payload),
    },
  };

  return deepFreeze(api);
}

module.exports = {
  createPreloadApi,
  deepFreeze,
};
