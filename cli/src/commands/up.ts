import { ensureSshKey, uploadSshKey, updateSshConfig, sshIntoSandbox, resolveTalosBinaryPath } from "../lib/ssh.js";
import { launchIde, resolveCwd } from "../lib/ide.js";
import { api } from "../api/client.js";
import { streamProgress, ProgressEvent } from "../api/progress.js";

// ANSI escape codes for terminal output
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CLEAR_LINE = "\r\x1b[2K";

// Friendly step names for display
const STEP_LABELS: Record<string, string> = {
  create_claim: "Creating sandbox",
  wake: "Waking sandbox",
  wait_ready: "Waiting for sandbox pod",
  inject_env: "Injecting environment",
  activate: "Activating sandbox",
  ready: "Ready for connection",
  error: "Error",
};

/**
 * Up command — create or wake a sandbox with progress display, then SSH into it
 * or launch an IDE.
 */
export async function upCommand(opts: { project: string; ide?: string; cwd?: string }) {
  console.log(`\n${BOLD}Talos — Starting your environment${RESET}\n`);

  // Step 1: SSH key
  process.stdout.write("  Checking SSH key...");
  ensureSshKey();
  process.stdout.write(`${CLEAR_LINE}  ${GREEN}✓${RESET} SSH key ready\n`);

  // Step 2: Upload SSH key
  process.stdout.write("  Uploading SSH key...");
  await uploadSshKey();
  process.stdout.write(`${CLEAR_LINE}  ${GREEN}✓${RESET} SSH key uploaded\n`);

  // Step 3: Create or wake sandbox
  process.stdout.write("  Creating sandbox...");
  const resp = await api("/api/sandboxes", {
    method: "POST",
    body: JSON.stringify({ project: opts.project }),
  });
  const data = (await resp.json()) as any;
  if (!resp.ok) {
    process.stdout.write(`${CLEAR_LINE}  ${RED}✗${RESET} ${data.error || "Failed to create sandbox"}\n`);
    process.exit(1);
  }

  const sandbox = data.sandbox;

  // If sandbox is already active (no operation needed)
  if (!data.operationId || sandbox.status === "active") {
    process.stdout.write(`${CLEAR_LINE}  ${GREEN}✓${RESET} Sandbox ready (${sandbox.sandboxclaim_name})\n`);
  } else {
    // Stream progress via SSE
    process.stdout.write(`${CLEAR_LINE}  ${YELLOW}⠋${RESET} Sandbox ${sandbox.status === "sleeping" ? "waking" : "creating"}...\n`);
    await showProgress(sandbox.id, data.operationId);
  }

  // Step 4: Write SSH config with ProxyCommand
  const binaryPath = resolveTalosBinaryPath();
  updateSshConfig(opts.project, binaryPath);
  process.stdout.write(`${CLEAR_LINE}  ${GREEN}✓${RESET} SSH config updated (host: talosd-${opts.project})\n`);

  // Step 5: Connect — launch IDE or SSH into sandbox
  const resolvedCwd = resolveCwd(opts.cwd);

  if (opts.ide) {
    // Launch IDE (e.g. VS Code Remote-SSH)
    launchIde(opts.ide, `talosd-${opts.project}`, resolvedCwd);
    console.log(`\n  ${GREEN}✓${RESET} VS Code launched — connecting to talosd-${opts.project}\n`);
  } else {
    // Default: interactive SSH session with retry for sandbox readiness
    const MAX_SSH_RETRIES = 3;
    const SSH_RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_SSH_RETRIES; attempt++) {
      console.log(`\n  ${BOLD}Connecting via SSH...${RESET}\n`);
      try {
        await sshIntoSandbox(opts.project, undefined, resolvedCwd);
        break;
      } catch (err) {
        if (attempt < MAX_SSH_RETRIES) {
          console.log(`  ${YELLOW}SSH connection failed (attempt ${attempt}/${MAX_SSH_RETRIES}), retrying in ${SSH_RETRY_DELAY_MS / 1000}s...${RESET}`);
          await new Promise(r => setTimeout(r, SSH_RETRY_DELAY_MS));
        } else {
          throw err;
        }
      }
    }
  }
}

/**
 * Display progress from SSE stream with step-by-step updates.
 */
function showProgress(sandboxId: number, operationId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stepStates = new Map<string, ProgressEvent>();

    const render = () => {
      // Move cursor up to rewrite progress lines
      const lines: string[] = [];
      const seen = new Set<string>();

      // Sort by step number and render
      const sorted = Array.from(stepStates.values()).sort((a, b) => a.step - b.step);
      for (const evt of sorted) {
        if (seen.has(evt.stepName)) continue;
        seen.add(evt.stepName);
        const label = STEP_LABELS[evt.stepName] || evt.stepName;
        const indent = "    ";

        if (evt.status === "completed") {
          lines.push(`${indent}${GREEN}  ├ ✓${RESET} ${label}`);
        } else if (evt.status === "in_progress") {
          lines.push(`${indent}${YELLOW}⠋${RESET} ${label}... ${GRAY}${evt.message || ""}${RESET}`);
        } else if (evt.status === "failed") {
          lines.push(`${indent}${RED}  ├ ✗${RESET} ${label}: ${evt.error || evt.message || "failed"}`);
        }
      }

      // Write all lines
      for (const line of lines) {
        process.stdout.write(`${CLEAR_LINE}${line}\n`);
      }
    };

    const cleanup = streamProgress(
      sandboxId,
      operationId,
      (event: ProgressEvent) => {
        stepStates.set(event.stepName, event);

        // If this is a failed event, reject
        if (event.status === "failed" && event.stepName === "error") {
          cleanup();
          console.error(`\n  ${RED}Error: ${event.message}${RESET}`);
          reject(new Error(event.message));
          return;
        }

        // Re-render for in_progress events (live updating)
        if (event.status === "in_progress") {
          // Just print the message inline for simple display
          const label = STEP_LABELS[event.stepName] || event.stepName;
          process.stdout.write(`${CLEAR_LINE}  ${YELLOW}⠋${RESET} ${label}... ${GRAY}${event.message || ""}${RESET}`);
        } else if (event.status === "completed") {
          const label = STEP_LABELS[event.stepName] || event.stepName;
          process.stdout.write(`${CLEAR_LINE}  ${GREEN}✓${RESET} ${label}\n`);
        }
      },
      () => {
        resolve();
      }
    );
  });
}
