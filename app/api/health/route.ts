import { env } from "@/lib/env";

export async function GET() {
  return Response.json({
    status: "ok",
    integrationsMode: env.INTEGRATIONS_MODE,
    time: new Date().toISOString(),
  });
}
