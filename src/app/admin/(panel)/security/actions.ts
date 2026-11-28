"use server";
import { z } from "zod";
import { confirmMfaEnrollment, disableMfa, MfaError, startMfaEnrollment } from "@/lib/admin/auth";
import { logActivity } from "@/lib/admin/audit";
import { adminAction, UserError } from "@/lib/admin/guard";
import { otpauthUri } from "@/lib/admin/totp";

async function friendlyMfa<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof MfaError) throw new UserError(e.message);
    throw e;
  }
}

// Start/confirm must work for an admin who still has to enrol (ADMIN_REQUIRE_MFA): allowWithoutMfa.
export const mfaStartAction = adminAction("dashboard.view", z.object({}), async (_i, { sql, session, actor }) => {
  const { secret } = await friendlyMfa(() => startMfaEnrollment(sql, session.user.id));
  await logActivity(sql, actor, { action: "admin.mfa_setup_started", entity: "admin_user", entityId: session.user.id, summary: "Started two-factor set-up" });
  return { ok: true, data: { secret, uri: otpauthUri(secret, session.user.email) } };
}, { allowWithoutMfa: true });

export const mfaConfirmAction = adminAction("dashboard.view", z.object({ code: z.string().trim().min(6).max(12) }), async (i, { sql, session, actor }) => {
  const { recoveryCodes } = await friendlyMfa(() => confirmMfaEnrollment(sql, session.user.id, i.code));
  await logActivity(sql, actor, { action: "admin.mfa_enabled", entity: "admin_user", entityId: session.user.id, summary: "Turned on two-factor sign-in" });
  return { ok: true, message: "Two-factor sign-in is on.", data: { recoveryCodes } };
}, { allowWithoutMfa: true });

export const mfaDisableAction = adminAction("dashboard.view", z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(40) }), async (i, { sql, session, actor }) => {
  await friendlyMfa(() => disableMfa(sql, session.user.id, i.password, i.code));
  await logActivity(sql, actor, { action: "admin.mfa_disabled", entity: "admin_user", entityId: session.user.id, summary: "Turned off two-factor sign-in" });
  return { ok: true, message: "Two-factor sign-in is off." };
});
