export interface GithubRepository {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}
export interface GithubPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  merged_at: string | null;
  updated_at: string;
  head: { sha: string; ref: string };
  requested_reviewers: { login: string }[];
  requested_teams?: { slug: string }[];
}
export interface GithubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  updated_at: string;
  pull_request?: unknown;
}
export interface GithubCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string } | null };
}
export interface GithubBranch { name: string; commit: { sha: string }; protected: boolean }
export interface GithubRun {
  id: number;
  workflow_id: number;
  head_branch: string;
  name: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  updated_at: string;
}
export interface GithubCheck {
  id: number;
  name: string;
  html_url: string | null;
  status: string;
  conclusion: string | null;
  head_sha: string;
}
export interface GithubStatus {
  context: string;
  state: string;
  target_url: string | null;
  sha: string;
}
export interface GithubSnapshot {
  repository: GithubRepository;
  readme: string;
  pulls: GithubPull[];
  issues: GithubIssue[];
  branches: GithubBranch[];
  commits: GithubCommit[];
  runs: GithubRun[];
  checks: GithubCheck[];
  statuses: GithubStatus[];
  limited: string[];
}
export interface GithubActivity { id: string; kind: string; title: string; url: string; created_at: number }
export interface GithubView {
  configured: boolean;
  owner: boolean;
  connected: boolean;
  connection?: { full_name: string; last_sync: number | null; last_error: string; pending: boolean; last_webhook: number | null };
  snapshot?: GithubSnapshot | null;
  activities?: GithubActivity[];
  members?: { id: string; username: string; allowed: boolean }[];
}
