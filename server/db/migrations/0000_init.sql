CREATE TYPE "public"."corrective_action_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('draft', 'submitted', 'cancelled', 'closed');--> statement-breakpoint
CREATE SEQUENCE "public"."server_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "answer_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"note" text,
	"photo_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"hlc" text NOT NULL,
	"device_id" text NOT NULL,
	"author_id" text NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrective_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"status" "corrective_action_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"close_note" text,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	CONSTRAINT "corrective_actions_source_event_id_unique" UNIQUE("source_event_id")
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"site" text NOT NULL,
	"status" "inspection_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at_device" timestamp with time zone NOT NULL,
	"submitted_at_device" timestamp with time zone,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"has_critical_failure" boolean DEFAULT false NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"hash" text PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"blob_url" text NOT NULL,
	"bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_mutations" (
	"mutation_id" uuid PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	CONSTRAINT "templates_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
ALTER TABLE "answer_events" ADD CONSTRAINT "answer_events_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_source_event_id_answer_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."answer_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_fk" FOREIGN KEY ("template_id","template_version") REFERENCES "public"."templates"("id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_events_inspection_item_idx" ON "answer_events" USING btree ("inspection_id","item_id");--> statement-breakpoint
CREATE INDEX "answer_events_server_seq_idx" ON "answer_events" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "corrective_actions_inspection_idx" ON "corrective_actions" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "corrective_actions_server_seq_idx" ON "corrective_actions" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "inspections_created_by_idx" ON "inspections" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "inspections_server_seq_idx" ON "inspections" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "photos_inspection_idx" ON "photos" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "templates_server_seq_idx" ON "templates" USING btree ("server_seq");