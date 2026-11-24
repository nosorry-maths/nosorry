import { json } from "@/lib/api";
import { siteOrigin } from "@/lib/origin";
import { CLIENT_VERSION, MIN_CLIENT_VERSION, CLIENT_CHANGES } from "../../../../../shared/version.mjs";

/** Public: what agent tools should be running. The CLI and the MCP server compare their own version with this. */
export async function GET() {
  const origin = await siteOrigin();
  return json({
    client_version: CLIENT_VERSION,
    min_client_version: MIN_CLIENT_VERSION,
    changes: CLIENT_CHANGES,
    update: {
      sh: `curl -fsSL ${origin}/skill/install.sh | sh`,
      powershell: `irm ${origin}/skill/install.ps1 | iex`,
      note: "Re-running the installer keeps your saved API key. Restart your agent afterwards so it reloads the MCP server.",
    },
  }, 200, { "cache-control": "public, max-age=300" });
}
