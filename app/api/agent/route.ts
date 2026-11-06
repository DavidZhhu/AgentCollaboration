import { env } from "cloudflare:workers";
import { handle } from "../../server";
export async function GET(r: Request) {
  return handle(r, env.DB!, true);
}
export async function POST(r: Request) {
  return handle(r, env.DB!, true);
}
