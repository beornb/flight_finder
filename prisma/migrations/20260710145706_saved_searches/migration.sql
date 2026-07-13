-- CreateTable
CREATE TABLE "saved_search" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "params" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "saved_result" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "saved_search_id" INTEGER NOT NULL,
    "plan_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_result_saved_search_id_fkey" FOREIGN KEY ("saved_search_id") REFERENCES "saved_search" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_search_params_key" ON "saved_search"("params");

-- CreateIndex
CREATE UNIQUE INDEX "saved_result_saved_search_id_plan_id_key" ON "saved_result"("saved_search_id", "plan_id");
