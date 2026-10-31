CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT 'New session' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "session_id" uuid;--> statement-breakpoint
-- Existing single-thread chats become one session per workspace, titled from the first user message.
INSERT INTO "chat_sessions" ("workspace_id", "title", "created_at", "updated_at")
SELECT m."workspace_id",
       COALESCE(LEFT((SELECT f."content" FROM "chat_messages" f WHERE f."workspace_id" = m."workspace_id" AND f."role" = 'user' ORDER BY f."created_at" LIMIT 1), 80), 'Conversation'),
       MIN(m."created_at"), MAX(m."created_at")
FROM "chat_messages" m GROUP BY m."workspace_id";--> statement-breakpoint
UPDATE "chat_messages" m SET "session_id" = s."id" FROM "chat_sessions" s WHERE s."workspace_id" = m."workspace_id";--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_sessions_ws_idx" ON "chat_sessions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_session_idx" ON "chat_messages" USING btree ("session_id","created_at");