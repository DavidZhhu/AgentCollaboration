import { env } from "cloudflare:workers";
import { handle } from "../../server";
import { currentAccount } from "../../auth";
async function workspace(request: Request) {
  const account = await currentAccount(request, env.DB!);
  if (!account)
    return Response.json(
      { error: "Please sign in." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const response = await handle(request, env.DB!, false, account);
  if (request.method === "GET" && response.ok) {
    const body = (await response.json()) as Record<string, unknown>;
    return Response.json(
      { ...body, account_role: account.role },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return response;
}
export const GET = workspace;
export const POST = workspace;
