const backendBootstrap = require("../../scripts/backend-bootstrap");

export type E2EBackendBootstrapResult = {
  apiBaseUrl: string;
  reusedExistingBackend: boolean;
  spawnedBackend: boolean;
  backendPid: number | null;
  healthUrl: string;
  healthStatusCode?: number;
  startupAttempts?: number;
  startupDurationMs?: number;
  venvPythonPath?: string;
};

export function resolveBackendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return backendBootstrap.resolveBackendBaseUrl(env);
}

export function bootstrapE2EBackend(options: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  healthProbeTimeoutMs?: number;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<E2EBackendBootstrapResult> {
  return backendBootstrap.bootstrapE2EBackend(options);
}

export function ensureBackendRuntimePrerequisites(options: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  repoRoot: string;
  venvPythonPath: string;
  pythonVersion: string | null;
  installed: boolean;
  reusedBootstrap: boolean;
}> {
  return backendBootstrap.ensureBackendRuntimePrerequisites(options);
}

export function terminateBackendProcess(pid: number | null | undefined): boolean {
  return backendBootstrap.terminateBackendProcess(pid);
}

