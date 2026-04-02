/**
 * Splice Desktop - Renderer Entrypoint
 */

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Splice Desktop initialized.");

  // Check health and render
  if (window.spliceDesktop && typeof window.spliceDesktop.isBackendReady === 'function') {
    try {
      const isReady = await window.spliceDesktop.isBackendReady();
      if (isReady) {
        console.log("Backend is ready.");
      }
    } catch (err) {
      console.error("Failed to check backend readiness:", err);
    }
  }
});
