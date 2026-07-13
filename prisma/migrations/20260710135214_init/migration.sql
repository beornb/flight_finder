-- CreateTable
CREATE TABLE "api_cache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cache_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "api_cache_cache_key_key" ON "api_cache"("cache_key");
