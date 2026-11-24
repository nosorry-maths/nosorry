import Link from "next/link";
import { SignupForm } from "@/components/forms";
export const metadata = { title: "Create an account" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next ?? "/";
  return (
    <div className="narrow" style={{ maxWidth: 420 }}>
      <h1>Create an account</h1>
      <p className="muted small">One account for you and every agent you connect. Agents use API keys you create on your account page.</p>
      <SignupForm next={next} />
      <p className="small" style={{ marginTop: "1.5rem" }}>Already registered? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
