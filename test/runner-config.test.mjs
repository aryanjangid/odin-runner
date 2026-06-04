import assert from "node:assert/strict";
import { test } from "node:test";

import {
  brokerUrlFromCallback,
  fetchRunnerConfig,
} from "../lib/runner-config.mjs";

test("brokerUrlFromCallback: swaps the agent-result path for runner-config", () => {
  assert.equal(
    brokerUrlFromCallback("https://odin.example/api/agent-result"),
    "https://odin.example/api/runner-config",
  );
  assert.equal(
    brokerUrlFromCallback("https://odin.example/api/agent-result/"),
    "https://odin.example/api/runner-config",
  );
});

test("brokerUrlFromCallback: falls back to the hosted orchestrator", () => {
  assert.equal(
    brokerUrlFromCallback(""),
    "https://odin-orchestrator.up.railway.app/api/runner-config",
  );
  assert.equal(
    brokerUrlFromCallback(undefined),
    "https://odin-orchestrator.up.railway.app/api/runner-config",
  );
});

test("fetchRunnerConfig: sends job id and runner config token", async () => {
  const previousFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    await fetchRunnerConfig(
      "https://odin.example/api/runner-config",
      "job-123",
      "token-abc",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(requestBody, {
    jobId: "job-123",
    runnerConfigToken: "token-abc",
  });
});
