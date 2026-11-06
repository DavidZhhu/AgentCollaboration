import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  direction: text("direction").notNull().default(""),
  repo: text("repo").notNull().default(""),
  deletedAt: integer("deleted_at"),
  createdAt: integer("created_at").notNull(),
});
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  role: text("role").notNull(),
  provider: text("provider").notNull(),
  responsibility: text("responsibility").notNull().default(""),
  workerId: text("worker_id"),
  workerSeen: integer("worker_seen"),
  workerStatus: text("worker_status").notNull().default("stopped"),
  workerError: text("worker_error").notNull().default(""),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("idle"),
  lastSeen: integer("last_seen"),
  deletedAt: integer("deleted_at"),
  createdAt: integer("created_at").notNull(),
});
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  criteria: text("criteria").notNull(),
  agentId: text("agent_id").references(() => agents.id),
  status: text("status").notNull().default("queued"),
  priority: text("priority").notNull().default("medium"),
  report: text("report"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  author: text("author").notNull(),
  authorType: text("author_type").notNull(),
  channel: text("channel").notNull().default("general"),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status").notNull().default("pending"),
  approval: text("approval"),
  createdAt: integer("created_at").notNull(),
});
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  role: text("role").notNull().default("member"),
  ownerKey: text("owner_key").unique(),
  passwordHash: text("password_hash"),
  inviteHash: text("invite_hash").unique(),
  inviteExpires: integer("invite_expires"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  expiresAt: integer("expires_at").notNull(),
});
export const authLimits = sqliteTable("auth_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const workerReceipts = sqliteTable("worker_receipts", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  requestHash: text("request_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});
