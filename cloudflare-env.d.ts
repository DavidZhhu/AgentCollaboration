declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    AUTH_BOOTSTRAP_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
