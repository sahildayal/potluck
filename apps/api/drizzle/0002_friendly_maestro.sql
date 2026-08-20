CREATE TABLE "catalog_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cuisine" text NOT NULL,
	"meal_type" text NOT NULL,
	"main_protein" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"servings" integer DEFAULT 2 NOT NULL,
	"total_minutes" integer,
	"difficulty" text DEFAULT 'easy' NOT NULL,
	"protein_grams" real,
	"calories" integer,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingredients_text" text DEFAULT '' NOT NULL,
	"tags_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_recipes_slug_key" ON "catalog_recipes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "catalog_recipes_meal_type_idx" ON "catalog_recipes" USING btree ("meal_type");--> statement-breakpoint
CREATE INDEX "catalog_recipes_cuisine_idx" ON "catalog_recipes" USING btree ("cuisine");--> statement-breakpoint
CREATE INDEX "catalog_recipes_protein_idx" ON "catalog_recipes" USING btree ("protein_grams");