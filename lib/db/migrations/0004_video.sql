ALTER TYPE "public"."artifact_type" ADD VALUE 'video';--> statement-breakpoint
ALTER TYPE "public"."artifact_type" ADD VALUE 'thumbnail';--> statement-breakpoint
ALTER TYPE "public"."artifact_type" ADD VALUE 'video_source';--> statement-breakpoint
ALTER TYPE "public"."job_kind" ADD VALUE 'video';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'composing_video' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'rendering_video' BEFORE 'completed';