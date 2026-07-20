/**
 * Cron Jobs — Scheduled background tasks for push notifications.
 *
 * Runs periodic checks to:
 * 1. Notify customers when invoices are about to expire (3 days before)
 * 2. Notify customers when invoices are overdue
 * 3. Notify customers when new invoices are detected
 *
 * NOTE: These cron jobs need a Convex deployment with the cron trigger enabled.
 * For local development, use `npx convex dev` which enables crons automatically.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Check for upcoming/overdue billing notifications every 6 hours
// This runs a Convex mutation that inspects session data and sends push
// notifications to subscribed customers.
crons.interval(
  "check-billing-notifications",
  { hours: 6 },
  internal.pushNotifications.checkAndNotify,
  {}
);

export default crons;
