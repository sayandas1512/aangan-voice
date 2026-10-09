CREATE TABLE "pending_prompts" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_prompts" ADD CONSTRAINT "pending_prompts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_prompts" ADD CONSTRAINT "pending_prompts_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;