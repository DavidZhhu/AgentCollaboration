import { env } from "cloudflare:workers";
import { setup } from "../../../setup-server";
export const POST = (request: Request) => setup(request, env.DB!, true);
