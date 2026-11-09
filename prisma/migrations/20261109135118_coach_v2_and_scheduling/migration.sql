-- CreateTable
CREATE TABLE "CoachPersona" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachAnalysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mediaId" TEXT,
    "kind" TEXT NOT NULL,
    "personaId" TEXT,
    "input" JSONB,
    "result" JSONB NOT NULL,
    "expectedRetention" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachChat" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "personaId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "videoPath" TEXT NOT NULL,
    "coverPath" TEXT,
    "shareToFeed" BOOLEAN NOT NULL DEFAULT true,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "containerId" TEXT,
    "mediaId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachPersona_workspaceId_idx" ON "CoachPersona"("workspaceId");

-- CreateIndex
CREATE INDEX "CoachAnalysis_workspaceId_mediaId_kind_idx" ON "CoachAnalysis"("workspaceId", "mediaId", "kind");

-- CreateIndex
CREATE INDEX "CoachChat_workspaceId_updatedAt_idx" ON "CoachChat"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "CoachMessage_chatId_createdAt_idx" ON "CoachMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduledPost_workspaceId_scheduledAt_idx" ON "ScheduledPost"("workspaceId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "CoachPersona" ADD CONSTRAINT "CoachPersona_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAnalysis" ADD CONSTRAINT "CoachAnalysis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAnalysis" ADD CONSTRAINT "CoachAnalysis_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "CoachPersona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachChat" ADD CONSTRAINT "CoachChat_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachChat" ADD CONSTRAINT "CoachChat_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "CoachPersona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "CoachChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
