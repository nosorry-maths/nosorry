import { siteOrigin } from "@/lib/origin";
import { config } from "@/lib/config";

/** RFC 9116: where to report a vulnerability. */
export async function GET() {
  const B = await siteOrigin();
  const contact = config.operator.security || config.operator.contact;
  const lines = [
    contact ? `Contact: ${/^https?:/.test(contact) ? contact : `mailto:${contact}`}` : `Contact: ${B}/docs/security`,
    `Expires: ${new Date(Date.now() + 180 * 86400_000).toISOString()}`,
    `Policy: ${B}/docs/security`,
    "Preferred-Languages: en, fr",
    `Canonical: ${B}/.well-known/security.txt`,
  ];
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
