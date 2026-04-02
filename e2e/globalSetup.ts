/**
 * Playwright globalSetup - reuse a healthy backend when available, otherwise bootstrap the
 * repo-managed Python environment and start a local uvicorn instance for the test lane.
 */
import path from "node:path";
import { assertRealSmokeAuthStubDisabled } from '../scripts/testing/e2e-policy.js';
import { bootstrapE2EBackend } from "./test-utils/backendBootstrap";
import {
  DEFAULT_E2E_AUTH_ACCESS_SECRET,
  DEFAULT_E2E_INTERNAL_API_TOKEN,
  resolveEnvOrDefault,
} from "./test-utils/authContext";

type GlobalSetupState = {
  apiBaseUrl: string;
  reusedExistingBackend: boolean;
  spawnedBackend: boolean;
  backendPid: number | null;
  healthUrl: string;
};

export default async function globalSetup(): Promise<GlobalSetupState> {
  const repoRoot = path.resolve(__dirname, "../");
  assertRealSmokeAuthStubDisabled({ env: process.env, context: "globalSetup" });

  const backend = await bootstrapE2EBackend({
    repoRoot,
    env: {
      ...process.env,
      SPLICE_AUTH_ACCESS_SECRET: resolveEnvOrDefault(
        process.env.SPLICE_AUTH_ACCESS_SECRET,
        DEFAULT_E2E_AUTH_ACCESS_SECRET,
      ),
      SPLICE_INTERNAL_API_TOKEN: resolveEnvOrDefault(
        process.env.SPLICE_INTERNAL_API_TOKEN,
        DEFAULT_E2E_INTERNAL_API_TOKEN,
      ),
      SPLICE_ENV: resolveEnvOrDefault(process.env.SPLICE_ENV, "local"),
      SPLICE_DB_PATH: path.join(repoRoot, "data", "test_pw_global.db"),
    },
  });

  process.env.PW_API_BASE_URL = backend.apiBaseUrl;
  return backend;
}
