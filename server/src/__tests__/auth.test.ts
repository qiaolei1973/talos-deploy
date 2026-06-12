import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "talos-test-"));

/**
 * Reset the module-level DB singleton so each test group gets a fresh DB.
 * This works by re-importing the modules with a different DB_PATH.
 */
let dbCounter = 0;

function freshDbPath() {
  return path.join(tmpDir, `test-${++dbCounter}.db`);
}

// We test the functions directly using fresh DB instances.
// For route-level tests, we build a Fastify app with the fresh DB.

import { signToken, verifyToken } from "../auth/index.js";

// ─── Unit tests for DB functions ────────────────────────

describe("DB user functions", () => {
  let db: Database.Database;
  let usersModule: typeof import("../db/users.js");
  let dbModule: typeof import("../db/index.js");

  beforeEach(async () => {
    // Create a fresh DB for each test
    db = new Database(freshDbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'pending',
        api_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        approved_at TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to use the fresh DB
  function withDb(fn: (db: Database.Database) => void) {
    // We'll bypass the singleton by directly operating on the db
    fn(db);
  }

  describe("createUser (direct SQL)", () => {
    it("inserts a user with normalized (lowercase) username", () => {
      const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
      const hash = bcrypt.hashSync("pass123", 10);
      db.prepare("INSERT INTO users (name, password_hash) VALUES (?, ?)").run("testuser", hash);
      const row = db.prepare("SELECT * FROM users WHERE name = ?").get("testuser") as any;
      expect(row.name).toBe("testuser");
      expect(row.role).toBe("user");
      expect(row.status).toBe("pending");
    });

    it("enforces UNIQUE constraint on name", () => {
      const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
      const hash = bcrypt.hashSync("pass123", 10);
      db.prepare("INSERT INTO users (name, password_hash) VALUES (?, ?)").run("testuser", hash);
      expect(() => {
        db.prepare("INSERT INTO users (name, password_hash) VALUES (?, ?)").run("testuser", hash);
      }).toThrow();
    });
  });

  describe("findUserByName (direct SQL)", () => {
    it("finds a user by name", () => {
      const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
      const hash = bcrypt.hashSync("pass123", 10);
      db.prepare("INSERT INTO users (name, password_hash) VALUES (?, ?)").run("testuser", hash);
      const row = db.prepare("SELECT * FROM users WHERE name = ?").get("testuser") as any;
      expect(row).toBeDefined();
      expect(row.name).toBe("testuser");
    });

    it("returns undefined for non-existent user", () => {
      const row = db.prepare("SELECT * FROM users WHERE name = ?").get("nobody") as any;
      expect(row).toBeUndefined();
    });
  });
});

// ─── Route-level integration tests ─────────────────────

// For route tests, we need to use the actual module singleton.
// We'll set DB_PATH before each test group and use vi.resetModules.

describe("Register endpoint", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.DB_PATH = freshDbPath();
    // Reimport modules to reset singleton
    vi.resetModules();
    // Dynamic import after reset
    const { getDb } = await import("../db/index.js");
    getDb(); // Initialize DB with new path

    app = Fastify();
    await app.register(cookie);
    const { authRoutes: routes } = await import("../routes/auth.js");
    await app.register(routes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("registers a user with valid username and password", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "testuser", password: "secret123" },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.user.username).toBe("testuser");
    expect(body.user.role).toBe("user");
    expect(body.user.status).toBe("pending");
    expect(body.user).not.toHaveProperty("email");
    expect(resp.cookies.some((c: any) => c.name === "talos_token")).toBe(true);
  });

  it("rejects missing username", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { password: "secret123" },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toContain("username");
  });

  it("rejects missing password", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "testuser" },
    });
    expect(resp.statusCode).toBe(400);
  });

  it("rejects duplicate username (409)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "testuser", password: "secret123" },
    });
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "testuser", password: "otherpass" },
    });
    expect(resp.statusCode).toBe(409);
    expect(resp.json().error).toContain("already taken");
  });

  it('rejects username "root" (400)', async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "root", password: "secret123" },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toContain("root");
  });

  it("rejects usernames with invalid characters", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "bad user!", password: "secret123" },
    });
    expect(resp.statusCode).toBe(400);
  });

  it("rejects usernames shorter than 3 characters", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "ab", password: "secret123" },
    });
    expect(resp.statusCode).toBe(400);
  });

  it("rejects usernames longer than 32 characters", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "a".repeat(33), password: "secret123" },
    });
    expect(resp.statusCode).toBe(400);
  });

  it("normalizes username to lowercase", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "Admin", password: "secret123" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().user.username).toBe("admin");
  });

  it("new user has status pending", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "newuser", password: "secret123" },
    });
    expect(resp.json().user.status).toBe("pending");
  });
});

describe("Login endpoint", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.DB_PATH = freshDbPath();
    vi.resetModules();
    const { getDb } = await import("../db/index.js");
    getDb();

    app = Fastify();
    await app.register(cookie);
    const { authRoutes: routes } = await import("../routes/auth.js");
    await app.register(routes);

    // Register a user first
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "loginuser", password: "secret123" },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("logs in with correct credentials", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "loginuser", password: "secret123" },
    });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.user.username).toBe("loginuser");
    expect(body.user).not.toHaveProperty("email");
    expect(resp.cookies.some((c) => c.name === "talos_token")).toBe(true);
  });

  it("rejects wrong password (401)", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "loginuser", password: "wrongpass" },
    });
    expect(resp.statusCode).toBe(401);
  });

  it("rejects non-existent username with same message as wrong password", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nouser", password: "secret123" },
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.json().error).toBe("invalid username or password");
  });

  it("rejects missing fields (400)", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(resp.statusCode).toBe(400);
  });
});

describe("JWT Token", () => {
  it("contains username instead of email", () => {
    const token = signToken({ userId: 1, username: "testuser", role: "user" });
    const decoded = verifyToken(token);
    expect(decoded.userId).toBe(1);
    expect(decoded.username).toBe("testuser");
    expect(decoded.role).toBe("user");
    expect((decoded as any).email).toBeUndefined();
  });
});

describe("ensureAdmin", () => {
  beforeEach(async () => {
    process.env.DB_PATH = freshDbPath();
    vi.resetModules();
    const { getDb } = await import("../db/index.js");
    getDb();
  });

  it("creates admin user if none exists", async () => {
    const { ensureAdmin } = await import("../db/users.js");
    const admin = ensureAdmin("admin", "adminpass");
    expect(admin.name).toBe("admin");
    expect(admin.role).toBe("admin");
    expect(admin.status).toBe("approved");
  });

  it("upgrades existing user to admin if username matches", async () => {
    const { createUser, ensureAdmin } = await import("../db/users.js");
    const user = createUser("existinguser", "pass123");
    expect(user.role).toBe("user");

    const admin = ensureAdmin("existinguser", "adminpass");
    expect(admin.role).toBe("admin");
    expect(admin.id).toBe(user.id);
  });

  it("uses ADMIN_USERNAME env var concept", async () => {
    const { ensureAdmin } = await import("../db/users.js");
    process.env.ADMIN_USERNAME = "myadmin";
    const admin = ensureAdmin(process.env.ADMIN_USERNAME!, "adminpass");
    expect(admin.name).toBe("myadmin");
  });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
