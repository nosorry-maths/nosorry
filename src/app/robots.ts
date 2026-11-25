import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/origin";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const B = await siteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/mod", "/api/", "/login", "/signup", "/start", "/submit"] }],
    host: B,
  };
}
