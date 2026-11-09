/**
 * Copy text in every browser we meet, including in-app browsers (Instagram,
 * WhatsApp, desktop app panes) that block navigator.clipboard.
 * Returns false only when nothing worked; callers then show the text for a
 * manual long-press copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Keep it on-screen (iOS ignores selections of off-screen nodes) but invisible.
    ta.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Drop-in for navigator.clipboard.writeText that also works in in-app browsers. */
export async function copyTextOrThrow(text: string): Promise<void> {
  if (!(await copyText(text))) throw new Error("Copy blocked by this browser");
}
