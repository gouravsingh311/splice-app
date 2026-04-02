import { terminateBackendProcess } from "./test-utils/backendBootstrap";

type GlobalSetupState = {
  spawnedBackend: boolean;
  backendPid: number | null;
};

export default async function globalTeardown(setupState?: GlobalSetupState) {
  if (!setupState?.spawnedBackend || !setupState.backendPid) {
    return;
  }

  terminateBackendProcess(setupState.backendPid);
}
