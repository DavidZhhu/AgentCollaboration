import { env } from "cloudflare:workers";
import { auth } from "../../auth";
export async function GET(request: Request) {
  return auth(request, env.DB!, env.AUTH_BOOTSTRAP_TOKEN);
}
export async function POST(request: Request) {
  return auth(request, env.DB!, env.AUTH_BOOTSTRAP_TOKEN);
}
