import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import path from "path";

/**
 * Process-level integration test: verifies that the ssh-proxy command does not
 * emit any dotenv banner text on stdout. When running as an SSH ProxyCommand,
 * stdout carries raw binary SSH protocol — any text pollution corrupts the
 * handshake ("Bad packet length").
 *
 * This test must run against the built CLI (npm run build), because the dotenv
 * side effect fires at module-import time and cannot be caught by in-process
 * DI mocks.
 */
describe("ssh-proxy stdout pollution", () => {
  it("emits no dotenv banner on stdout when ssh-proxy fails with no auth", async () => {
    const cliPath = path.resolve(__dirname, "../../dist/index.js");

    const child = spawn("node", [cliPath, "ssh-proxy", "--project", "default"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME }, // inherit HOME so .env can be found
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    // The command should fail (no auth token configured) — that's expected.
    // What matters is that stdout is clean.
    expect(exitCode).not.toBe(0);

    // Stdout must contain NO dotenv banner text
    expect(stdout).not.toContain("injected env");
    expect(stdout).not.toContain("◇");
    expect(stdout).toBe("");

    // Stderr should contain the "Not logged in" error, proving the command ran
    expect(stderr).toContain("Not logged in");
  });
});
