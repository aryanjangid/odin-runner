import { spawn } from "node:child_process";

// Run a command, inheriting stdio so its output streams to the Actions console.
// Rejects with a clear error on a non-zero exit.
export function run(command, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

// Run a shell command STRING (for user-configured install/check commands that may
// contain pipes, &&, or args). Inherits stdio.
export function runShell(commandString, opts = {}) {
  return run("bash", ["-lc", commandString], opts);
}

// Run a command and return its trimmed stdout. Used for `gh`/`git` queries.
export function capture(command, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"], ...opts });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
