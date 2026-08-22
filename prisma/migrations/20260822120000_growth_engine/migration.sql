-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('MANUAL', 'SEMI_AUTOMATIC', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentObjective" AS ENUM ('REACH', 'ENGAGEMENT', 'LEADS', 'SALES');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('REEL', 'CAROUSEL', 'IMAGE', 'STORY', 'TEXT');

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('AWARENESS', 'INTEREST', 'CONSIDERATION', 'DECISION', 'RETENTION');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'THUMBNAIL', 'CAPTIONS');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('CONNECTED', 'TOKEN_EXPIRED', 'DISCONNECTED', 'MOCK');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('QUEUED', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('IG_DM', 'IG_COMMENT', 'FB_MESSENGER', 'FB_COMMENT');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'WAITING_CUSTOMER', 'WAITING_HUMAN', 'HUMAN_HANDLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SENT', 'FAILED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('COLD', 'WARM', 'HOT', 'READY');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CHECKOUT_SENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('STRATEGY_GENERATE', 'CONTENT_GENERATE', 'MEDIA_GENERATE', 'CONTENT_PUBLISH', 'COMMENT_REPLY', 'DM_SEND', 'FOLLOW_UP_SEND', 'CHECKOUT_LINK_SEND', 'HUMAN_HANDOFF');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('MARKET_STRATEGIST', 'CONTENT_STRATEGIST', 'VIDEO_CREATOR', 'SOCIAL_MANAGER', 'LEAD_QUALIFIER', 'SALES_REP', 'LEARNING_ANALYST');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "InsightDimension" AS ENUM ('THEME', 'HOOK', 'CTA', 'FORMAT', 'AUDIENCE', 'FUNNEL_STAGE', 'OBJECTION');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('AGENT', 'HUMAN', 'SYSTEM');

-- AlterTable
ALTER TABLE "ai_usage_logs" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "growth_workspaces" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mode" "ApprovalMode" NOT NULL DEFAULT 'MANUAL',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "quietHoursStart" INTEGER NOT NULL DEFAULT 21,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
    "maxDailyCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "maxMessagesPerContactPerDay" INTEGER NOT NULL DEFAULT 3,
    "maxPublicationsPerDay" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_workspace_members" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_brand_profiles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "toneOfVoice" TEXT NOT NULL DEFAULT 'Profissional, direto e acolhedor.',
    "valueProposition" TEXT,
    "doNotSay" JSONB NOT NULL DEFAULT '[]',
    "guardrails" JSONB NOT NULL DEFAULT '[]',
    "defaultCta" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_products" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "checkoutUrl" TEXT,
    "schedulingUrl" TEXT,
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "faq" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_market_strategies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "brief" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "persona" JSONB NOT NULL,
    "pains" JSONB NOT NULL,
    "desires" JSONB NOT NULL,
    "objections" JSONB NOT NULL,
    "competitors" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "valueProposition" TEXT NOT NULL,
    "offer" JSONB NOT NULL,
    "toneOfVoice" TEXT NOT NULL,
    "promptName" TEXT,
    "promptVersion" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_market_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_content_plans" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "strategyId" TEXT,
    "title" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "pillars" JSONB NOT NULL DEFAULT '[]',
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "insightsUsed" JSONB,
    "promptName" TEXT,
    "promptVersion" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_content_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_content_pieces" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT,
    "objective" "ContentObjective" NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "funnelStage" "FunnelStage" NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "targets" JSONB NOT NULL DEFAULT '[]',
    "scheduledFor" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_content_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_media_assets" (
    "id" TEXT NOT NULL,
    "contentPieceId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "durationSec" INTEGER,
    "text" TEXT,
    "meta" JSONB,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_social_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "pageId" TEXT,
    "tokenRef" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" JSONB,
    "status" "AccountStatus" NOT NULL DEFAULT 'MOCK',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_publications" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentPieceId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "permalink" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_content_metrics" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "videoViews" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER NOT NULL DEFAULT 0,
    "profileVisits" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "isMock" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "growth_content_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_contacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "username" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_conversations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "summary" TEXT,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "sourceContentPieceId" TEXT,
    "sourcePublicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_messages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "text" TEXT NOT NULL,
    "externalId" TEXT,
    "agent" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blockedReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_leads" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "temperature" "LeadTemperature" NOT NULL DEFAULT 'COLD',
    "score" INTEGER NOT NULL DEFAULT 0,
    "intent" TEXT,
    "problem" TEXT,
    "productId" TEXT,
    "budget" TEXT,
    "urgency" TEXT,
    "decisionStage" TEXT,
    "objections" JSONB NOT NULL DEFAULT '[]',
    "funnelStage" "FunnelStage" NOT NULL DEFAULT 'AWARENESS',
    "qualifiedAt" TIMESTAMP(3),
    "sourceContentPieceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_deals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "productId" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'NEW',
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "valueCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "checkoutUrl" TEXT,
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_follow_up_tasks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "draft" TEXT,
    "sentMessageId" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_follow_up_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_approval_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actionType" "ActionType" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requestedByAgent" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_webhook_events" (
    "id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_agent_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "promptName" TEXT,
    "promptVersion" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "growth_agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_learning_insights" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dimension" "InsightDimension" NOT NULL,
    "subject" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "statement" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "evidence" JSONB,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_learning_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_audit_logs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "mode" "ApprovalMode" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "growth_workspaces_slug_key" ON "growth_workspaces"("slug");

-- CreateIndex
CREATE INDEX "growth_workspaces_ownerId_idx" ON "growth_workspaces"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_workspace_members_workspaceId_userId_key" ON "growth_workspace_members"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_brand_profiles_workspaceId_key" ON "growth_brand_profiles"("workspaceId");

-- CreateIndex
CREATE INDEX "growth_products_workspaceId_isActive_idx" ON "growth_products"("workspaceId", "isActive");

-- CreateIndex
CREATE INDEX "growth_market_strategies_workspaceId_status_idx" ON "growth_market_strategies"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "growth_content_plans_workspaceId_status_idx" ON "growth_content_plans"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "growth_content_pieces_workspaceId_status_scheduledFor_idx" ON "growth_content_pieces"("workspaceId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "growth_content_pieces_planId_idx" ON "growth_content_pieces"("planId");

-- CreateIndex
CREATE INDEX "growth_media_assets_contentPieceId_kind_idx" ON "growth_media_assets"("contentPieceId", "kind");

-- CreateIndex
CREATE INDEX "growth_social_accounts_workspaceId_status_idx" ON "growth_social_accounts"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "growth_social_accounts_workspaceId_platform_externalId_key" ON "growth_social_accounts"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "growth_publications_workspaceId_status_scheduledFor_idx" ON "growth_publications"("workspaceId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "growth_publications_contentPieceId_socialAccountId_key" ON "growth_publications"("contentPieceId", "socialAccountId");

-- CreateIndex
CREATE INDEX "growth_content_metrics_publicationId_capturedAt_idx" ON "growth_content_metrics"("publicationId", "capturedAt");

-- CreateIndex
CREATE INDEX "growth_contacts_workspaceId_lastInteractionAt_idx" ON "growth_contacts"("workspaceId", "lastInteractionAt");

-- CreateIndex
CREATE UNIQUE INDEX "growth_contacts_workspaceId_platform_externalId_key" ON "growth_contacts"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "growth_conversations_workspaceId_status_updatedAt_idx" ON "growth_conversations"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "growth_conversations_contactId_idx" ON "growth_conversations"("contactId");

-- CreateIndex
CREATE INDEX "growth_messages_conversationId_createdAt_idx" ON "growth_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "growth_messages_workspaceId_status_idx" ON "growth_messages"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "growth_messages_workspaceId_externalId_key" ON "growth_messages"("workspaceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_leads_contactId_key" ON "growth_leads"("contactId");

-- CreateIndex
CREATE INDEX "growth_leads_workspaceId_temperature_updatedAt_idx" ON "growth_leads"("workspaceId", "temperature", "updatedAt");

-- CreateIndex
CREATE INDEX "growth_deals_workspaceId_status_stage_idx" ON "growth_deals"("workspaceId", "status", "stage");

-- CreateIndex
CREATE INDEX "growth_follow_up_tasks_workspaceId_status_scheduledFor_idx" ON "growth_follow_up_tasks"("workspaceId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "growth_approval_requests_workspaceId_status_createdAt_idx" ON "growth_approval_requests"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "growth_approval_requests_entityType_entityId_idx" ON "growth_approval_requests"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "growth_jobs_dedupeKey_key" ON "growth_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "growth_jobs_status_runAt_idx" ON "growth_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "growth_jobs_workspaceId_type_status_idx" ON "growth_jobs"("workspaceId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "growth_webhook_events_externalId_key" ON "growth_webhook_events"("externalId");

-- CreateIndex
CREATE INDEX "growth_webhook_events_status_createdAt_idx" ON "growth_webhook_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "growth_agent_runs_workspaceId_agent_createdAt_idx" ON "growth_agent_runs"("workspaceId", "agent", "createdAt");

-- CreateIndex
CREATE INDEX "growth_learning_insights_workspaceId_dimension_createdAt_idx" ON "growth_learning_insights"("workspaceId", "dimension", "createdAt");

-- CreateIndex
CREATE INDEX "growth_audit_logs_workspaceId_createdAt_idx" ON "growth_audit_logs"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_logs_workspaceId_createdAt_idx" ON "ai_usage_logs"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_workspaces" ADD CONSTRAINT "growth_workspaces_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_workspace_members" ADD CONSTRAINT "growth_workspace_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_workspace_members" ADD CONSTRAINT "growth_workspace_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_brand_profiles" ADD CONSTRAINT "growth_brand_profiles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_products" ADD CONSTRAINT "growth_products_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_market_strategies" ADD CONSTRAINT "growth_market_strategies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_content_plans" ADD CONSTRAINT "growth_content_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_content_plans" ADD CONSTRAINT "growth_content_plans_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "growth_market_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_content_pieces" ADD CONSTRAINT "growth_content_pieces_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_content_pieces" ADD CONSTRAINT "growth_content_pieces_planId_fkey" FOREIGN KEY ("planId") REFERENCES "growth_content_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_content_pieces" ADD CONSTRAINT "growth_content_pieces_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_media_assets" ADD CONSTRAINT "growth_media_assets_contentPieceId_fkey" FOREIGN KEY ("contentPieceId") REFERENCES "growth_content_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_social_accounts" ADD CONSTRAINT "growth_social_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_publications" ADD CONSTRAINT "growth_publications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_publications" ADD CONSTRAINT "growth_publications_contentPieceId_fkey" FOREIGN KEY ("contentPieceId") REFERENCES "growth_content_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_publications" ADD CONSTRAINT "growth_publications_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "growth_social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_content_metrics" ADD CONSTRAINT "growth_content_metrics_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "growth_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_contacts" ADD CONSTRAINT "growth_contacts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_contacts" ADD CONSTRAINT "growth_contacts_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "growth_social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_conversations" ADD CONSTRAINT "growth_conversations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_conversations" ADD CONSTRAINT "growth_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "growth_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_conversations" ADD CONSTRAINT "growth_conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_conversations" ADD CONSTRAINT "growth_conversations_sourceContentPieceId_fkey" FOREIGN KEY ("sourceContentPieceId") REFERENCES "growth_content_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_conversations" ADD CONSTRAINT "growth_conversations_sourcePublicationId_fkey" FOREIGN KEY ("sourcePublicationId") REFERENCES "growth_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_messages" ADD CONSTRAINT "growth_messages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_messages" ADD CONSTRAINT "growth_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "growth_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "growth_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "growth_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_productId_fkey" FOREIGN KEY ("productId") REFERENCES "growth_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_sourceContentPieceId_fkey" FOREIGN KEY ("sourceContentPieceId") REFERENCES "growth_content_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_deals" ADD CONSTRAINT "growth_deals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_deals" ADD CONSTRAINT "growth_deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "growth_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_deals" ADD CONSTRAINT "growth_deals_productId_fkey" FOREIGN KEY ("productId") REFERENCES "growth_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_follow_up_tasks" ADD CONSTRAINT "growth_follow_up_tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_follow_up_tasks" ADD CONSTRAINT "growth_follow_up_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "growth_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_follow_up_tasks" ADD CONSTRAINT "growth_follow_up_tasks_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "growth_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_follow_up_tasks" ADD CONSTRAINT "growth_follow_up_tasks_sentMessageId_fkey" FOREIGN KEY ("sentMessageId") REFERENCES "growth_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_approval_requests" ADD CONSTRAINT "growth_approval_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_approval_requests" ADD CONSTRAINT "growth_approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_jobs" ADD CONSTRAINT "growth_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_agent_runs" ADD CONSTRAINT "growth_agent_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_learning_insights" ADD CONSTRAINT "growth_learning_insights_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_audit_logs" ADD CONSTRAINT "growth_audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "growth_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

