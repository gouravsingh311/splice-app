const http = require("node:http");
const { randomUUID } = require("node:crypto");

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });

  res.end(body);
}

function writeText(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "cache-control": "no-store",
  });

  res.end(payload);
}

function buildMetrics({ requestsByPath, startedAt }) {
  const processUptimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const sortedPaths = Object.keys(requestsByPath).sort();

  const pathMetrics = sortedPaths
    .map((pathName) => `splice_desktop_http_requests_total{path="${pathName}"} ${requestsByPath[pathName]}`)
    .join("\n");

  return [
    "# HELP splice_desktop_process_uptime_seconds Electron desktop process uptime in seconds",
    "# TYPE splice_desktop_process_uptime_seconds gauge",
    `splice_desktop_process_uptime_seconds ${processUptimeSeconds}`,
    "# HELP splice_desktop_http_requests_total Total requests received by endpoint",
    "# TYPE splice_desktop_http_requests_total counter",
    pathMetrics,
    "",
  ].join("\n");
}

function startHealthServer({ config, logger, getReadyState = () => true }) {
  if (!config.enableHealthServer) {
    logger.info("Health server disabled via runtime config");

    return Promise.resolve(null);
  }

  const startedAt = Date.now();
  const requestsByPath = {};

  const server = http.createServer((req, res) => {
    const requestPath = req.url || "/";
    const correlationId = req.headers["x-correlation-id"] || randomUUID();

    requestsByPath[requestPath] = (requestsByPath[requestPath] || 0) + 1;

    if (requestPath === "/health/live") {
      writeJson(res, 200, {
        service: config.appName,
        status: "live",
        environment: config.environment,
        correlationId,
      });

      return;
    }

    if (requestPath === "/health/ready") {
      const isReady = Boolean(getReadyState());

      writeJson(res, isReady ? 200 : 503, {
        service: config.appName,
        status: isReady ? "ready" : "not_ready",
        environment: config.environment,
        correlationId,
      });

      return;
    }

    if (requestPath === "/version") {
      writeJson(res, 200, {
        service: config.appName,
        version: config.appVersion,
        environment: config.environment,
        correlationId,
      });

      return;
    }

    if (requestPath === "/metrics") {
      writeText(
        res,
        200,
        buildMetrics({
          requestsByPath,
          startedAt,
        }),
      );

      return;
    }

    writeJson(res, 404, {
      code: "NOT_FOUND",
      message: "Endpoint not found",
      correlationId,
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      reject(error);
    });

    server.listen(config.healthPort, "127.0.0.1", () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : config.healthPort;

      logger.info("Health server started", { port: activePort });

      resolve({
        getPort: () => activePort,
        stop: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }

              logger.info("Health server stopped");
              closeResolve();
            });
          }),
      });
    });
  });
}

module.exports = {
  startHealthServer,
};
