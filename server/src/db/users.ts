import { getDb } from "./index.js";
import bcrypt from "bcryptjs";

export interface User {
  id: number;
  name: string;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected";
  api_key: string | null;
  created_at: string;
  approved_at: string | null;
}

export function createUser(username: string, password: string): User {
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(
    "INSERT INTO users (name, password_hash) VALUES (?, ?)"
  );
  const result = stmt.run(username.toLowerCase(), hash);
  return findUserById(result.lastInsertRowid as number)!;
}

export function findUserByName(name: string): (User & { password_hash: string }) | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE name = ?").get(name.toLowerCase()) as any;
}

export function findUserById(id: number): User | undefined {
  const db = getDb();
  return db.prepare("SELECT id, name, role, status, api_key, created_at, approved_at FROM users WHERE id = ?").get(id) as User | undefined;
}

export function verifyPassword(user: any, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}

export function listPendingUsers(): User[] {
  const db = getDb();
  return db.prepare("SELECT id, name, role, status, api_key, created_at, approved_at FROM users WHERE status = 'pending'").all() as User[];
}

export function listAllUsers(): User[] {
  const db = getDb();
  return db.prepare("SELECT id, name, role, status, api_key, created_at, approved_at FROM users ORDER BY created_at DESC").all() as User[];
}

export function approveUser(id: number, apiKey: string): User | undefined {
  const db = getDb();
  db.prepare(
    "UPDATE users SET status = 'approved', api_key = ?, approved_at = datetime('now') WHERE id = ?"
  ).run(apiKey, id);
  return findUserById(id);
}

export function rejectUser(id: number): User | undefined {
  const db = getDb();
  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(id);
  return findUserById(id);
}

export function updateUserApiKey(id: number, apiKey: string): void {
  const db = getDb();
  db.prepare("UPDATE users SET api_key = ? WHERE id = ?").run(apiKey, id);
}

export function ensureAdmin(username: string, password: string): User {
  const existing = findUserByName(username);
  if (existing) {
    if (existing.role !== "admin") {
      const db = getDb();
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    }
    return findUserById(existing.id)!;
  }
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(
    "INSERT INTO users (name, password_hash, role, status, approved_at) VALUES (?, ?, 'admin', 'approved', datetime('now'))"
  );
  const result = stmt.run(username.toLowerCase(), hash);
  return findUserById(result.lastInsertRowid as number)!;
}
