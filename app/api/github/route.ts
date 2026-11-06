import { env } from "cloudflare:workers";
import { githubProject } from "../../github-server";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => githubProject(request, env.DB!, env);
export const POST = (request: Request) => githubProject(request, env.DB!, env);
