import { redirect } from "next/navigation";

// Short, stable URL for the terms page (kept in docs/site/terms.md).
export default function Page() { redirect("/docs/terms"); }
