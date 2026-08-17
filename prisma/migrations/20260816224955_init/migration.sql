-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('AIRBNB', 'BOOKING', 'PHOTOS', 'PRICING', 'RECOMMENDATIONS', 'REPORT');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PhotoAnalysisStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('AIRBNB', 'BOOKING');

-- CreateEnum
CREATE TYPE "ListingSource" AS ENUM ('MANUAL', 'MOCK', 'API');

-- CreateEnum
CREATE TYPE "PricingSource" AS ENUM ('CSV_PRICELABS', 'PRICELABS_API');

-- CreateEnum
CREATE TYPE "RecommendationCategory" AS ENUM ('PHOTOS', 'CONTENT', 'AMENITIES', 'PRICING', 'REPUTATION', 'POLICIES', 'COMPETITIVENESS');

-- CreateEnum
CREATE TYPE "ImpactLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "propertyType" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" DOUBLE PRECISION,
    "maxGuests" INTEGER,
    "airbnbUrl" TEXT,
    "bookingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "overallScore" INTEGER,
    "airbnbScore" INTEGER,
    "bookingScore" INTEGER,
    "pricingScore" INTEGER,
    "photoScore" INTEGER,
    "contentScore" INTEGER,
    "reputationScore" INTEGER,
    "scoreBreakdown" JSONB,
    "scoreConfigId" TEXT,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_steps" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "type" "StepType" NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "result" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_analyses" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "status" "PhotoAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "roomType" TEXT,
    "visualQuality" INTEGER,
    "lighting" INTEGER,
    "composition" INTEGER,
    "professionalism" INTEGER,
    "valuePerception" INTEGER,
    "clarity" INTEGER,
    "score" INTEGER,
    "strengths" JSONB,
    "problems" JSONB,
    "recommendations" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "fromCache" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photo_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_snapshots" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "source" "ListingSource" NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "externalUrl" TEXT,
    "data" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_analyses" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "score" INTEGER,
    "scoreBreakdown" JSONB,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "missingInfo" JSONB,
    "positioning" TEXT,
    "raw" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_datasets" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "source" "PricingSource" NOT NULL,
    "fileName" TEXT,
    "currency" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "columnMapping" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rows" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "price" DOUBLE PRECISION,
    "recommendedPrice" DOUBLE PRECISION,
    "minPrice" DOUBLE PRECISION,
    "maxPrice" DOUBLE PRECISION,
    "occupancy" DOUBLE PRECISION,
    "booked" BOOLEAN,
    "bookings" INTEGER,
    "adr" DOUBLE PRECISION,
    "revpar" DOUBLE PRECISION,
    "leadTimeDays" INTEGER,
    "minStay" INTEGER,
    "season" TEXT,
    "events" JSONB,
    "adjustmentPct" DOUBLE PRECISION,
    "weekendMarkupPct" DOUBLE PRECISION,
    "discountPct" DOUBLE PRECISION,
    "weekday" INTEGER NOT NULL,
    "isWeekend" BOOLEAN NOT NULL,
    "raw" JSONB,

    CONSTRAINT "pricing_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_analyses" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "problems" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "RecommendationCategory" NOT NULL,
    "priority" "ImpactLevel" NOT NULL,
    "estimatedImpact" "ImpactLevel" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "evidence" JSONB,
    "sourceStep" "StepType",
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "platform" "Platform",
    "externalUrl" TEXT,
    "price" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "photoCount" INTEGER,
    "amenities" JSONB,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ai_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_configs" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "weights" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "properties_userId_idx" ON "properties"("userId");

-- CreateIndex
CREATE INDEX "analyses_userId_createdAt_idx" ON "analyses"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "analyses_propertyId_idx" ON "analyses"("propertyId");

-- CreateIndex
CREATE INDEX "analysis_steps_status_idx" ON "analysis_steps"("status");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_steps_analysisId_type_key" ON "analysis_steps"("analysisId", "type");

-- CreateIndex
CREATE INDEX "photos_sha256_idx" ON "photos"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "photos_analysisId_position_key" ON "photos"("analysisId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "photo_analyses_photoId_key" ON "photo_analyses"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_snapshots_analysisId_platform_key" ON "listing_snapshots"("analysisId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "listing_analyses_analysisId_platform_key" ON "listing_analyses"("analysisId", "platform");

-- CreateIndex
CREATE INDEX "pricing_datasets_analysisId_idx" ON "pricing_datasets"("analysisId");

-- CreateIndex
CREATE INDEX "pricing_rows_datasetId_date_idx" ON "pricing_rows"("datasetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rows_datasetId_date_key" ON "pricing_rows"("datasetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_analyses_analysisId_key" ON "pricing_analyses"("analysisId");

-- CreateIndex
CREATE INDEX "recommendations_analysisId_rank_idx" ON "recommendations"("analysisId", "rank");

-- CreateIndex
CREATE INDEX "competitors_analysisId_idx" ON "competitors"("analysisId");

-- CreateIndex
CREATE INDEX "ai_usage_logs_analysisId_idx" ON "ai_usage_logs"("analysisId");

-- CreateIndex
CREATE INDEX "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_cache_cacheKey_key" ON "ai_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "ai_cache_expiresAt_idx" ON "ai_cache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "score_configs_version_key" ON "score_configs"("version");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_scoreConfigId_fkey" FOREIGN KEY ("scoreConfigId") REFERENCES "score_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_steps" ADD CONSTRAINT "analysis_steps_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_analyses" ADD CONSTRAINT "photo_analyses_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_snapshots" ADD CONSTRAINT "listing_snapshots_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_analyses" ADD CONSTRAINT "listing_analyses_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_datasets" ADD CONSTRAINT "pricing_datasets_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rows" ADD CONSTRAINT "pricing_rows_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "pricing_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_analyses" ADD CONSTRAINT "pricing_analyses_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
