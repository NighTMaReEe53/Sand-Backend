-- Adhkar & Duas: أذكار وأدعية
CREATE TYPE "AdhkarCategory" AS ENUM ('MORNING', 'EVENING');
CREATE TYPE "DuaSubCategory" AS ENUM ('EXAM', 'STUDY', 'GENERAL', 'RELIEF', 'POST_EXAM', 'POST_LECTURE');

-- CreateTable
CREATE TABLE "adhkar_items" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" "AdhkarCategory" NOT NULL,
    "arabic_text" TEXT NOT NULL,
    "repeat_count" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adhkar_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dua_items" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sub_category" "DuaSubCategory" NOT NULL DEFAULT 'GENERAL',
    "arabic_text" TEXT NOT NULL,
    "translation_note" TEXT,
    "source" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dua_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adhkar_dismissals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reappears_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adhkar_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adhkar_items_code_key" ON "adhkar_items"("code");
CREATE INDEX "adhkar_items_category_sort_order_idx" ON "adhkar_items"("category", "sort_order");

CREATE UNIQUE INDEX "dua_items_code_key" ON "dua_items"("code");
CREATE INDEX "dua_items_sub_category_sort_order_idx" ON "dua_items"("sub_category", "sort_order");

CREATE UNIQUE INDEX "adhkar_dismissals_user_id_item_id_key" ON "adhkar_dismissals"("user_id", "item_id");
CREATE INDEX "adhkar_dismissals_user_id_reappears_at_idx" ON "adhkar_dismissals"("user_id", "reappears_at");

-- AddForeignKey
ALTER TABLE "adhkar_dismissals" ADD CONSTRAINT "adhkar_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adhkar_dismissals" ADD CONSTRAINT "adhkar_dismissals_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "adhkar_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
