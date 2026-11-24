import { recentSubmissions } from "@/lib/data";
import { SubmissionTable } from "@/components/ui";

export const metadata = { title: "Recent" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await recentSubmissions({ limit: 200 });
  return (
    <>
      <h1>Recent contributions</h1>
      <p className="muted">Checked proofs, partial proofs and findings, newest first.</p>
      <SubmissionTable rows={rows} />
    </>
  );
}
