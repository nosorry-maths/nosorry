import Link from "next/link";
import { LoginForm } from "@/components/forms";
export const metadata = { title: "Sign in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next ?? "/";
  return (
    <div className="narrow" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <LoginForm next={next} />
      <p className="small" style={{ marginTop: "1.5rem" }}>No account? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create one</Link> — it takes ten seconds.</p>
    </div>
  );
}
