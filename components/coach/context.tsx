"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { gooeyToast } from "@/lib/hd-toast";
import { coachApi, uploadVideo } from "@/lib/coach/client";
import {
  MAX_UPLOAD_BYTES,
  type AnalyzeResult,
  type CoachKind,
  type CoachPersonaData,
  type SavedAnalysis,
} from "@/lib/coach/types";

/**
 * Coach client state: personas, the selected persona, every saved analysis
 * (newest first) and the actions that create them. Pending analyze jobs are
 * polled every few seconds until they finish.
 */

type Busy = Record<string, boolean>;
type Errors = Record<string, string | undefined>;

interface CoachState {
  personas: CoachPersonaData[];
  setPersonas: (p: CoachPersonaData[]) => void;
  personaId: string | null;
  setPersonaId: (id: string) => void;
  analyses: SavedAnalysis[];
  busy: Busy;
  errors: Errors;
  uploadProgress: number | null;
  latest: (kind: CoachKind, mediaId: string | null) => SavedAnalysis | undefined;
  fix: (mediaId: string) => Promise<void>;
  write: (idea: string, length: "short" | "long") => Promise<boolean>;
  analyze: (target: { mediaId?: string; uploadId?: string }) => Promise<SavedAnalysis | null>;
  uploadAndAnalyze: (file: File) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const Ctx = createContext<CoachState | null>(null);

export function useCoach() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCoach outside CoachProvider");
  return v;
}

const POLL_MS = 3000;

export function CoachProvider({
  initialPersonas,
  initialAnalyses,
  accountId,
  children,
}: {
  initialPersonas: CoachPersonaData[];
  initialAnalyses: SavedAnalysis[];
  accountId: string | null;
  children: ReactNode;
}) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [chosen, setChosen] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [busy, setBusy] = useState<Busy>({});
  const [errors, setErrors] = useState<Errors>({});
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Selected persona: the one tapped (if it still exists), else the default.
  const personaId =
    (chosen && personas.some((p) => p.id === chosen) ? chosen : null) ??
    personas.find((p) => p.isDefault)?.id ??
    personas[0]?.id ??
    null;

  const accountParam = accountId ? { instagramAccountId: accountId } : {};

  const upsert = (a: SavedAnalysis) =>
    setAnalyses((list) => [a, ...list.filter((x) => x.id !== a.id)]);

  async function track<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (busy[key]) return null;
    setBusy((b) => ({ ...b, [key]: true }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setErrors((e) => ({ ...e, [key]: message }));
      return null;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  const latest = (kind: CoachKind, mediaId: string | null) =>
    analyses.find((a) => a.kind === kind && a.mediaId === mediaId);

  async function fix(mediaId: string) {
    await track(`fix:${mediaId}`, async () => {
      const { analysis } = await coachApi<{ analysis: SavedAnalysis }>("/api/hook-coach", {
        body: { mode: "fix", mediaId, personaId, ...accountParam },
      });
      upsert(analysis);
    });
  }

  async function write(idea: string, length: "short" | "long") {
    const ok = await track("write", async () => {
      const { analysis } = await coachApi<{ analysis: SavedAnalysis }>("/api/hook-coach", {
        body: { mode: "write", idea, length, personaId, ...accountParam },
      });
      upsert(analysis);
      return true;
    });
    return ok === true;
  }

  async function analyze(target: { mediaId?: string; uploadId?: string }) {
    const key = `analyze:${target.mediaId ?? target.uploadId}`;
    return track(key, async () => {
      const { analysis } = await coachApi<{ analysis: SavedAnalysis }>("/api/coach/analyze", {
        body: { ...target, personaId, ...accountParam },
      });
      upsert(analysis);
      return analysis;
    });
  }

  async function uploadAndAnalyze(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      gooeyToast.error("Videos up to 200 MB.");
      return;
    }
    await track("upload", async () => {
      setUploadProgress(0);
      try {
        const uploadId = await uploadVideo(file, setUploadProgress);
        const { analysis } = await coachApi<{ analysis: SavedAnalysis }>("/api/coach/analyze", {
          body: { uploadId, personaId, ...accountParam },
        });
        upsert(analysis);
      } finally {
        setUploadProgress(null);
      }
    });
  }

  async function remove(id: string) {
    try {
      await coachApi(`/api/coach/analyses/${id}`, { method: "DELETE" });
      setAnalyses((list) => list.filter((a) => a.id !== id));
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  // Poll pending analyze jobs.
  const pendingIds = analyses
    .filter((a) => a.kind === "analyze" && (a.result as AnalyzeResult)?.status === "pending")
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    if (!pendingIds) return;
    const ids = pendingIds.split(",");
    const timer = setInterval(async () => {
      for (const id of ids) {
        try {
          const { data } = await coachApi<{ data: SavedAnalysis }>(`/api/coach/analyses/${id}`);
          const status = (data.result as AnalyzeResult)?.status;
          setAnalyses((list) => list.map((a) => (a.id === id ? data : a)));
          if (status === "done") gooeyToast.success("Your reel review is ready");
        } catch {
          // keep polling; a transient error shouldn't kill the card
        }
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingIds]);

  return (
    <Ctx.Provider
      value={{
        personas,
        setPersonas,
        personaId,
        setPersonaId: setChosen,
        analyses,
        busy,
        errors,
        uploadProgress,
        latest,
        fix,
        write,
        analyze,
        uploadAndAnalyze,
        remove,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
