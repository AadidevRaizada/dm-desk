import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanHook,
  pickFont,
  plannedDuration,
  previewJpeg,
  probeDurationSec,
  renderVariantFile,
  sha256File,
} from "@/lib/strategy/variants";

const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
const canRender = Boolean(FFMPEG && pickFont());

describe("variant helpers", () => {
  it("caps long hooks at a word boundary", () => {
    const long = "word ".repeat(40);
    const out = cleanHook(long);
    expect(out.length).toBeLessThanOrEqual(91);
    expect(out.endsWith("…")).toBe(true);
    expect(cleanHook("  two   spaces ")).toBe("two spaces");
  });

  it("refuses cuts that leave under 3 seconds", () => {
    expect(plannedDuration({ hook: null, trimStartSec: 1 }, 10)).toBe(9);
    expect(plannedDuration({ hook: null, trimStartSec: 1, maxDurationSec: 5 }, 10)).toBe(5);
    expect(() => plannedDuration({ hook: null, trimStartSec: 8 }, 10)).toThrow(/3 seconds/);
  });
});

describe.skipIf(!canRender)("variant render (ffmpeg smoke test)", () => {
  let dir = "";
  let src = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dmdesk-variant-"));
    src = path.join(dir, "sample.mp4");
    execFileSync(FFMPEG as string, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=6",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src,
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("burns in a hook, trims the start and never matches the source bytes", async () => {
    const out = path.join(dir, "variant.mp4");
    const result = await renderVariantFile({
      src,
      out,
      spec: { hook: "Stop scrolling: this one trick & <more>", trimStartSec: 0.5 },
      tag: "test:A",
    });
    expect(existsSync(out)).toBe(true);
    expect(result.durationSec).toBeGreaterThan(5.2);
    expect(result.durationSec).toBeLessThan(5.8);
    expect(await probeDurationSec(out)).toBeCloseTo(result.durationSec, 1);
    expect(result.sha256).not.toBe(await sha256File(src));
    expect(existsSync(`${out}.hook.png`)).toBe(false);
  }, 60_000);

  it("re-encodes without a hook and honours a max length", async () => {
    const out = path.join(dir, "short.mp4");
    const result = await renderVariantFile({ src, out, spec: { hook: null, maxDurationSec: 4 }, tag: "test:B" });
    expect(result.durationSec).toBeGreaterThan(3.8);
    expect(result.durationSec).toBeLessThan(4.3);
    expect(result.sha256).not.toBe(await sha256File(src));
  }, 60_000);

  it("draws a JPEG preview of the first frame with the hook", async () => {
    const jpg = await previewJpeg(src, { hook: "Preview hook", trimStartSec: 1 }, 200);
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);
    expect(jpg.length).toBeGreaterThan(1000);
  }, 60_000);
});
