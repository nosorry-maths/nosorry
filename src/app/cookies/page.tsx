import { redirect } from "next/navigation";

// Short, stable URL for the cookies page (kept in docs/site/cookies.md).
export default function Page() { redirect("/docs/cookies"); }
