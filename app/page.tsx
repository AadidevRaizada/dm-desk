import { redirect } from "next/navigation";

// DM Desk is a private, single-account tool: no marketing page.
// The dashboard layout sends signed-out visitors to /login.
export default function Home() {
  redirect("/dashboard");
}
