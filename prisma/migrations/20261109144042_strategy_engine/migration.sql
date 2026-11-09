-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "experimentId" TEXT,
ADD COLUMN     "graduatedAt" TIMESTAMP(3),
ADD COLUMN     "hook" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "metrics" JSONB,
ADD COLUMN     "metricsAt" TIMESTAMP(3),
ADD COLUMN     "sourceMediaId" TEXT,
ADD COLUMN     "variantLabel" TEXT;

-- CreateTable
CREATE TABLE "StrategyExperiment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variable" TEXT NOT NULL DEFAULT 'hook',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceMediaId" TEXT,
    "winnerPostId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyTag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyExperiment_workspaceId_createdAt_idx" ON "StrategyExperiment"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyExperiment_status_idx" ON "StrategyExperiment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyTag_workspaceId_mediaId_key" ON "StrategyTag"("workspaceId", "mediaId");

-- CreateIndex
CREATE INDEX "ScheduledPost_experimentId_idx" ON "ScheduledPost"("experimentId");

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategyExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyTag" ADD CONSTRAINT "StrategyTag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
