function registerPermissionGuards({ session, logger }) {
  if (!session || !session.defaultSession) {
    return;
  }

  if (typeof session.defaultSession.setPermissionRequestHandler !== "function") {
    return;
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (logger && typeof logger.warn === "function") {
      logger.warn("Denied renderer permission request", { permission });
    }

    callback(false);
  });
}

module.exports = {
  registerPermissionGuards,
};
