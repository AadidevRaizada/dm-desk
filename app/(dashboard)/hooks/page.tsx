/**
 * /hooks moved to /coach (Hook Coach is now "Coach"). Old links and
 * bookmarks redirect, keeping the query string (e.g. ?instagramAccountId=).
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";

export default function HooksPage(props: PageProps<"/hooks">) {
  return (
    <Suspense fallback={null}>
      <RedirectToCoach searchParams={props.searchParams} />
    </Suspense>
  );
}

async function RedirectToCoach({
  searchParams,
}: {
  searchParams: PageProps<"/hooks">["searchParams"];
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const query = qs.toString();
  return redirect(query ? `/coach?${query}` : "/coach");
}
