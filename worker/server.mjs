import { createServer } from "node:http";

import { reviewCasePayload } from "./review-core.mjs";

const port = Number(process.env.PORT || "3000");

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { ok: false, error: "Missing request URL." });
    return;
  }

  if (
    request.method === "GET" &&
    (request.url === "/" || request.url === "/health")
  ) {
    sendJson(response, 200, {
      ok: true,
      service: "blind-arbiter-eigencompute-worker",
      version: process.env.WORKER_VERSION || "eigencompute-worker-v1",
      image: process.env.WORKER_IMAGE || "blindarbiter/arbiter-worker:eigencompute-dev",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/review") {
    try {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const body = Buffer.concat(chunks).toString("utf8");
      const payload = JSON.parse(body);
      const result = reviewCasePayload(payload);
      sendJson(response, 200, result);
      return;
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid review payload.",
      });
      return;
    }
  }

  sendJson(response, 404, { ok: false, error: "Not found." });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`BlindArbiter EigenCompute worker listening on :${port}`);
});
