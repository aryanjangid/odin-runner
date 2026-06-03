// Borrow Odin's shared Anthropic key (and the callback secret) at run time when
// the repo didn't set them itself — so most repos need ZERO secrets. Odin's broker
// (/api/runner-config) returns the shared Anthropic key only if the repo is on the
// admin allowlist; otherwise the repo must bring its own ANTHROPIC_API_KEY.

// The broker lives on the same Odin host as the result callback.
export function brokerUrlFromCallback(callbackUrl) {
  const base =
    callbackUrl || "https://odin-orchestrator.up.railway.app/api/agent-result";
  return base.replace(/\/api\/agent-result\/?$/, "/api/runner-config");
}

export async function fetchRunnerConfig(brokerUrl, jobId) {
  const res = await fetch(brokerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok) {
    throw new Error(`Runner config request failed: HTTP ${res.status}`);
  }
  return res.json();
}
