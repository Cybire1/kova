CREATE UNIQUE INDEX "ussd_pockets_active_phone_idx" ON "ussd_pockets" ("phone") WHERE "status" = 'active';
