import { FastifyInstance } from "fastify";
import { signToken, authMiddleware } from "../auth/index.js";
import { createUser, findUserByName, verifyPassword, User } from "../db/users.js";

const COOKIE_OPTS = {
  path: "/",
  maxAge: 7 * 24 * 60 * 60, // 7 days, matches JWT expiry
  sameSite: "lax" as const,
};

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const RESERVED_NAMES = new Set(["root"]);

function validateUsername(username: string): string | null {
  if (!username) return "username is required";
  const lower = username.toLowerCase();
  if (lower.length < 3) return "username must be at least 3 characters";
  if (lower.length > 32) return "username must be at most 32 characters";
  if (RESERVED_NAMES.has(lower)) return 'username "root" is not allowed';
  if (!USERNAME_RE.test(lower)) return "username must contain only lowercase letters, digits, -, _, and .";
  return null;
}

export async function authRoutes(app: FastifyInstance) {
  // ── Register ──────────────────────────────────────────

  app.post("/api/auth/register", async (request, reply) => {
    const { username, password } = request.body as any;
    if (!username || !password) {
      return reply.status(400).send({ error: "username and password are required" });
    }

    const validationError = validateUsername(username);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const normalized = username.toLowerCase();
    const existing = findUserByName(normalized);
    if (existing) {
      return reply.status(409).send({ error: "username already taken" });
    }

    const user = createUser(normalized, password);
    const token = signToken({ userId: user.id, username: user.name, role: user.role });
    reply.setCookie("talos_token", token, COOKIE_OPTS);
    return {
      user: { id: user.id, username: user.name, role: user.role, status: user.status },
    };
  });

  // ── Login ─────────────────────────────────────────────

  app.post("/api/auth/login", async (request, reply) => {
    const { username, password } = request.body as any;
    if (!username || !password) {
      return reply.status(400).send({ error: "username and password required" });
    }

    const user: (User & { password_hash: string }) | undefined = findUserByName(username);
    if (!user) {
      return reply.status(401).send({ error: "invalid username or password" });
    }

    if (!verifyPassword(user as any, password)) {
      return reply.status(401).send({ error: "invalid username or password" });
    }

    const token = signToken({ userId: user.id, username: user.name, role: user.role });
    reply.setCookie("talos_token", token, COOKIE_OPTS);
    return {
      user: { id: user.id, username: user.name, role: user.role, status: user.status },
    };
  });

  // ── CLI Token (requires cookie auth, issues token for CLI) ──

  app.post("/api/auth/cli-token", { preHandler: authMiddleware }, async (request) => {
    const token = signToken({
      userId: request.user!.userId,
      username: request.user!.username,
      role: request.user!.role,
    });
    return { token };
  });

  // ── Status ────────────────────────────────────────────

  app.get("/api/auth/status", { preHandler: authMiddleware }, async (request) => {
    return { user: request.user };
  });

  // ── Logout ────────────────────────────────────────────

  app.post("/api/auth/logout", async (request, reply) => {
    reply.clearCookie("talos_token", { path: "/" });
    return { ok: true };
  });
}
