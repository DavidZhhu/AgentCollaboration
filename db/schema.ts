import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
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
  accountId: text("account_id").references(() => accounts.id),
  connectionMode: text("connection_mode").notNull().default("worker"),
  controllerLabel: text("controller_label").notNull().default(""),
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

export const setupGrants = sqliteTable("setup_grants", {
  codeHash: text("code_hash").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  provider: text("provider").notNull(),
  sessionMode: text("session_mode").notNull(),
  sessionId: text("session_id").notNull().default(""),
  folder: text("folder").notNull(),
  cloneRepo: integer("clone_repo").notNull().default(1),
  expiresAt: integer("expires_at").notNull(),
});
export const setupChecks = sqliteTable("setup_checks", {
  agentId: text("agent_id").primaryKey().references(() => agents.id),
  nonce: text("nonce").notNull(),
  status: text("status").notNull().default("pending"),
  summary: text("summary").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const githubConnections = sqliteTable("github_connections", {
  projectId: text("project_id").primaryKey().references(() => projects.id),
  generation: text("generation").notNull(),
  repositoryId: integer("repository_id").notNull(),
  installationId: integer("installation_id").notNull(),
  fullName: text("full_name").notNull(),
  snapshot: text("snapshot"),
  version: integer("version").notNull().default(1),
  syncedVersion: integer("synced_version").notNull().default(0),
  lastSync: integer("last_sync"),
  lastWebhook: integer("last_webhook"),
  lastError: text("last_error").notNull().default(""),
  retryAt: integer("retry_at").notNull().default(0),
  lockUntil: integer("lock_until").notNull().default(0),
  active: integer("active").notNull().default(1),
}, table => [index("github_repository_installation").on(table.repositoryId, table.installationId)]);

export const githubProjectMembers = sqliteTable("github_project_members", {
  projectId: text("project_id").notNull().references(() => projects.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
}, table => [primaryKey({ columns: [table.projectId, table.accountId] })]);

export const githubActivity = sqliteTable("github_activity", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  generation: text("generation").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("github_project_activity").on(table.projectId, table.generation, table.createdAt)]);

export const githubDeliveries = sqliteTable("github_deliveries", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull(),
  createdAt: integer("created_at").notNull(),
});
