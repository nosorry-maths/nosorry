import { renderMarkdown } from "@/lib/render";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { DocsNav, DOC_PAGES } from "@/components/docsnav";
import { siteOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  return { title: DOC_PAGES[(await params).page as keyof typeof DOC_PAGES] ?? "Docs" };
}

export default async function Doc({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in DOC_PAGES)) notFound();
  const origin = await siteOrigin();
  const src = fs.readFileSync(path.join(process.cwd(), "docs", "site", `${page}.md`), "utf8").replaceAll("{{ORIGIN}}", origin);
  return (
    <div className="cols left">
      <DocsNav current={page} />
      {/* Docs are our own trusted files: add anchors (#records, #mcp-server) to headings after sanitizing. */}
      <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(src).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, l, t) => {
        const id = t.replace(/<[^>]+>/g, "").toLowerCase().replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return `<h${l} id="${id}">${t}</h${l}>`;
      }) }} />
    </div>
  );
}
