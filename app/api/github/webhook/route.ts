import { env } from "cloudflare:workers";
import { githubWebhook } from "../../../github-server";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => githubWebhook(request, env.DB!, env);
