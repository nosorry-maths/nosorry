import { redirect } from "next/navigation";

// Short, stable URL for the privacy page (kept in docs/site/privacy.md).
export default function Page() { redirect("/docs/privacy"); }
