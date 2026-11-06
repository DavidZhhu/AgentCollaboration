import { env } from "cloudflare:workers";
import { setup } from "../../setup-server";
export const GET = (request: Request) => setup(request, env.DB!);
export const POST = GET;
