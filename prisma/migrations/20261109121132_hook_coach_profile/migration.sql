-- CreateTable
CREATE TABLE "HookCoachProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "niche" TEXT NOT NULL DEFAULT '',
    "cta" TEXT NOT NULL DEFAULT '',
    "references" TEXT[],
    "audience" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HookCoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HookCoachProfile_workspaceId_key" ON "HookCoachProfile"("workspaceId");

-- AddForeignKey
ALTER TABLE "HookCoachProfile" ADD CONSTRAINT "HookCoachProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
