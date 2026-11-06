declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    AUTH_BOOTSTRAP_TOKEN?: string;
    GITHUB_APP_ID?: string;
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_WEBHOOK_SECRET?: string;
    BUCKET?: R2Bucket;
  }
}
