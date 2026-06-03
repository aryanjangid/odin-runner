import assert from "node:assert/strict";
import { test } from "node:test";

import { brokerUrlFromCallback } from "../lib/runner-config.mjs";

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
