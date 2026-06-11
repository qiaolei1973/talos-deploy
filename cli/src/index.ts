#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { authLoginCommand, authStatusCommand, authLogoutCommand } from "./commands/auth.js";
import { upCommand } from "./commands/up.js";
import { sshProxyCommand } from "./commands/ssh-proxy.js";
import { clearConfig, clearAuth } from "./config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();
program
  .name("talosd")
  .description("Talos Deploy CLI — sandbox environments for Claude Code")
  .version(version);

// ── auth ──────────────────────────────────────────────────

const authCmd = program
  .command("auth")
  .description("Manage authentication")
  .action(async () => {
    // Default: show status (like `gh auth`)
    await authStatusCommand();
  });

authCmd
  .command("login")
  .description("Login via browser")
  .option("--force", "Force re-login even if already authenticated")
  .action(async (opts) => {
    if (opts.force) clearConfigForced();
    await authLoginCommand();
  });

authCmd
  .command("status")
  .description("Show current auth status")
  .action(async () => {
    await authStatusCommand();
  });

authCmd
  .command("logout")
  .description("Logout")
  .action(() => {
    authLogoutCommand();
  });

// Backward compat: `talosd login` → `talosd auth login`
program
  .command("login")
  .description("Login via browser (alias for auth login)")
  .action(async () => {
    await authLoginCommand();
  });

// ── up ────────────────────────────────────────────────────

program
  .command("up")
  .description("Create or wake your sandbox and connect via SSH")
  .option("-p, --project <name>", "Project name", "default")
  .option("--ide <name>", "IDE to launch after sandbox is ready (vscode)")
  .option("--cwd <path>", "Working directory on the remote (relative to /home/coder/projects)")
  .action(async (opts) => {
    await upCommand({ project: opts.project, ide: opts.ide, cwd: opts.cwd });
  });

// ── ssh-proxy ─────────────────────────────────────────────
// Used as SSH ProxyCommand: SSH client spawns this to relay traffic via WebSocket

program
  .command("ssh-proxy")
  .description("SSH ProxyCommand relay — connect stdin/stdout to sandbox via WebSocket")
  .requiredOption("--project <name>", "Project name")
  .action(async (opts) => {
    await sshProxyCommand(opts.project);
  });

program.parse();

// Helper for --force: clear auth state but preserve serverUrl
function clearConfigForced() {
  clearAuth();
}
