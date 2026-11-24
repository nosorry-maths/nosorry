import Link from "next/link";

export default function NotFound() {
  return (
    <div className="narrow">
      <div className="ident">404</div>
      <h1>Not in the archive</h1>
      <p className="muted">This page does not exist, or the submission is private to its author.</p>
      <p className="sans small"><Link href="/list/math">Browse problems</Link> · <Link href="/search">Search</Link></p>
    </div>
  );
}
