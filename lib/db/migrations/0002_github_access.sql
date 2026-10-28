ALTER TABLE "users" ADD COLUMN "github_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_token_scopes" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_token_login" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_repositories" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;