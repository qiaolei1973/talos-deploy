import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { getDb } from "./db/index.js";
import { ensureAdmin } from "./db/users.js";
import { authRoutes } from "./routes/auth.js";
import { sshKeyRoutes } from "./routes/ssh-keys.js";
import { sandboxRoutes } from "./routes/sandboxes.js";
import { adminRoutes } from "./routes/admin.js";
import { progressRoutes } from "./progress/sse-handler.js";
import { startIdleChecker } from "./scheduler/idle-checker.js";
import { initNewApi, ensureNewApiChannel } from "./newapi/index.js";
import { handleSshRelay } from "./routes/sandboxes-ssh.js";

const PORT = Number(process.env.PORT) || 8080;
const ADMIN_USERNAME: string = (() => {
  const val = process.env.ADMIN_USERNAME;
  if (!val) {
    console.error("FATAL: ADMIN_USERNAME environment variable is required");
    process.exit(1);
  }
  return val;
})();
const ADMIN_PASSWORD: string = (() => {
  const val = process.env.ADMIN_PASSWORD;
  if (!val) {
    console.error("FATAL: ADMIN_PASSWORD environment variable is required");
    process.exit(1);
  }
  return val;
})();

async function main() {
  // Initialize DB
  getDb();

  // Ensure admin user exists
  const admin = ensureAdmin(ADMIN_USERNAME, ADMIN_PASSWORD);
  console.log(`Admin user: ${admin.name} (id=${admin.id})`);

  // Initialize New API session (blocking — ensures admin session before accepting traffic)
  await initNewApi();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(cookie);

  // Routes
  await app.register(authRoutes);
  await app.register(sshKeyRoutes);
  await app.register(sandboxRoutes);
  await app.register(adminRoutes);
  await app.register(progressRoutes);

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  // Start idle checker
  startIdleChecker();

  // Serve static dashboard (must be after API routes)
  // In production, dist/web is populated by the build step.
  // In dev mode, the Vite dev server serves the frontend — missing dist/web is non-fatal.
  const webDir = path.join(process.cwd(), "dist/web");
  const indexHtmlPath = path.join(webDir, "index.html");
  if (fs.existsSync(webDir)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback — serve index.html for all non-API GET routes
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.type("text/html").send(fs.readFileSync(indexHtmlPath));
      }
      return reply.code(404).send({ error: "not found" });
    });
  } else {
    console.warn(`Static dir ${webDir} not found — skipping static serving (dev mode: use Vite dev server)`);
    app.setNotFoundHandler((request, reply) => {
      return reply.code(404).send({ error: "not found" });
    });
  }

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Talos Portal running on :${PORT}`);

  // Attach WebSocket server AFTER listen() — app.server is null before this
  const wss = new WebSocketServer({ noServer: true });
  app.server.on("upgrade", (request, socket, head) => {
    const url = request.url || "/";
    const match = url.match(/^\/api\/sandboxes\/(\d+)\/ssh(\?.*)?$/);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as any).__sandboxId = Number(match[1]);
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    console.log(`WebSocket SSH relay connection: ${(ws as any).__sandboxId}`);
    handleSshRelay(ws, request);
  });

  // Init new-api upstream channel in background (session already validated by initNewApi)
  ensureNewApiChannel().catch((e: any) => {
    console.warn(`new-api channel init failed: ${e.message}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
