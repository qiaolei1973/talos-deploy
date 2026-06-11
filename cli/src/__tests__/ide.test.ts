import { describe, it, expect } from "vitest";
import { resolveCwd, launchIde } from "../lib/ide.js";

describe("resolveCwd", () => {
  it("returns baseDir when cwd is undefined", () => {
    expect(resolveCwd(undefined)).toBe("/home/coder/projects");
  });

  it("returns baseDir when cwd is undefined with custom baseDir", () => {
    expect(resolveCwd(undefined, "/custom/base")).toBe("/custom/base");
  });

  it("resolves relative path against baseDir", () => {
    expect(resolveCwd("my-repo")).toBe("/home/coder/projects/my-repo");
  });

  it("resolves nested relative path against baseDir", () => {
    expect(resolveCwd("workspaces/my-repo")).toBe(
      "/home/coder/projects/workspaces/my-repo"
    );
  });

  it("passes through absolute path unchanged", () => {
    expect(resolveCwd("/tmp/foo")).toBe("/tmp/foo");
  });

  it("passes through absolute path even with custom baseDir", () => {
    expect(resolveCwd("/opt/workspace", "/custom/base")).toBe("/opt/workspace");
  });
});

describe("launchIde", () => {
  it("launches VS Code with correct remote command", () => {
    let capturedCmd = "";
    const fakeExec = (cmd: string) => {
      capturedCmd = cmd;
      if (cmd.startsWith("which")) return Buffer.from("/usr/bin/code\n");
      return Buffer.from("");
    };

    launchIde("vscode", "talosd-default", "/home/coder/projects", {
      execFn: fakeExec,
    });

    expect(capturedCmd).toBe(
      "code --remote ssh-remote+talosd-default /home/coder/projects"
    );
  });

  it("launches VS Code with cwd set to a subdirectory", () => {
    let capturedCmd = "";
    const fakeExec = (cmd: string) => {
      capturedCmd = cmd;
      if (cmd.startsWith("which")) return Buffer.from("/usr/bin/code\n");
      return Buffer.from("");
    };

    launchIde("vscode", "talosd-default", "/home/coder/projects/my-repo", {
      execFn: fakeExec,
    });

    expect(capturedCmd).toBe(
      "code --remote ssh-remote+talosd-default /home/coder/projects/my-repo"
    );
  });

  it("launches VS Code without cwd when cwd is undefined", () => {
    let capturedCmd = "";
    const fakeExec = (cmd: string) => {
      capturedCmd = cmd;
      if (cmd.startsWith("which")) return Buffer.from("/usr/bin/code\n");
      return Buffer.from("");
    };

    launchIde("vscode", "talosd-default", undefined, {
      execFn: fakeExec,
    });

    expect(capturedCmd).toBe(
      "code --remote ssh-remote+talosd-default"
    );
  });

  it("throws for unsupported IDE with supported values listed", () => {
    expect(() => launchIde("vim", "talosd-default", "/home/coder/projects")).toThrow(
      `Unsupported IDE: "vim". Supported values: vscode`
    );
  });

  it("throws actionable error when IDE binary is not in PATH", () => {
    const fakeExec = (_cmd: string) => {
      throw new Error("not found");
    };

    expect(() =>
      launchIde("vscode", "talosd-default", "/home/coder/projects", {
        execFn: fakeExec,
      })
    ).toThrow('"code" is not in your PATH');
  });
});
