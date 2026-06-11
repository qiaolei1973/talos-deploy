import path from "path";
import { execSync } from "child_process";

// ── Supported IDEs ──────────────────────────────────────

const SUPPORTED_IDES: Record<string, { binary: string; remoteFlag: string }> = {
  vscode: { binary: "code", remoteFlag: "ssh-remote" },
};

// Default base directory on the remote sandbox
const DEFAULT_BASE_DIR = "/home/coder/projects";

// ── Types ───────────────────────────────────────────────

export interface LaunchIdeDeps {
  execFn: (cmd: string) => Buffer;
}

// ── resolveCwd ──────────────────────────────────────────

/**
 * Resolve the remote working directory path.
 *
 * - If cwd is undefined, returns baseDir (useful as VS Code default).
 * - If cwd is absolute, returns as-is.
 * - If cwd is relative, joins with baseDir.
 */
export function resolveCwd(
  cwd: string | undefined,
  baseDir: string = DEFAULT_BASE_DIR
): string | undefined {
  if (cwd === undefined) {
    return baseDir;
  }
  if (path.isAbsolute(cwd)) {
    return cwd;
  }
  return path.resolve(baseDir, cwd);
}

// ── launchIde ───────────────────────────────────────────

/**
 * Launch an IDE connected to the remote sandbox via SSH.
 *
 * Fire-and-forget: does not await the IDE process. Returns immediately.
 *
 * @param ide   IDE name (e.g. "vscode")
 * @param host  SSH host alias (e.g. "talosd-default")
 * @param cwd   Remote working directory
 * @param deps  Optional dependency injection for testing
 */
export function launchIde(
  ide: string,
  host: string,
  cwd: string | undefined,
  deps?: Partial<LaunchIdeDeps>
): void {
  const execFn = deps?.execFn ?? execSync;

  const ideConfig = SUPPORTED_IDES[ide];
  if (!ideConfig) {
    const supported = Object.keys(SUPPORTED_IDES).join(", ");
    throw new Error(
      `Unsupported IDE: "${ide}". Supported values: ${supported}`
    );
  }

  // Check that the IDE binary is available in PATH
  try {
    execFn(`which ${ideConfig.binary}`);
  } catch {
    throw new Error(
      `"${ideConfig.binary}" is not in your PATH. ` +
        `For VS Code, open the Command Palette (Ctrl+Shift+P) and run ` +
        `"Shell Command: Install 'code' command in PATH".`
    );
  }

  // Build and execute: code --remote ssh-remote <host> <cwd>
  const remotePart = cwd ? `${host} ${cwd}` : host;
  const cmd = `${ideConfig.binary} --remote ${ideConfig.remoteFlag} ${remotePart}`;
  execFn(cmd);
}
