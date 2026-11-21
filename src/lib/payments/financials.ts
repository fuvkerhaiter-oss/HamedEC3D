/**
 * Actual payment financials from the provider's balance transaction (Stripe: gross, fee, net, settlement
 * currency). Never estimated from a percentage. `fee_amount` (used by profit reports in order currency) is
 * set only when the settlement currency equals the payment currency; otherwise it stays unknown (null).
 * One record per balance transaction (UNIQUE index) — re-syncs never duplicate.
 */
import type { Db } from "../db/client";
import type { BalanceFigures, PaymentProvider } from "./types";
import { logError } from "../log";

export async function recordPaymentFinancials(db: Db, providerId: string, providerPaymentId: string, b: BalanceFigures): Promise<boolean> {
  const rows = await db`
    update public.payments set
      balance_transaction_id = ${b.transactionId}, gross_amount = ${b.gross}, net_amount = ${b.net}, settlement_currency = ${b.currency},
      fee_amount = case when currency::text = ${b.currency} then ${b.fee}::bigint else null end,
      financials_synced_at = now()
    where provider = ${providerId} and provider_payment_id = ${providerPaymentId}
      and (balance_transaction_id is null or balance_transaction_id = ${b.transactionId})
    returning id`;
  return rows.length > 0;
}

/** Backstop (cron): fill financials for recent succeeded payments whose balance transaction wasn't ready at webhook time. */
export async function syncMissingPaymentFinancials(db: Db, getProvider: (id: string) => PaymentProvider | null, limit = 25): Promise<number> {
  const rows = await db<{ provider: string; provider_payment_id: string }[]>`
    select provider, provider_payment_id from public.payments
     where status in ('succeeded','partially_refunded','refunded') and provider_payment_id is not null and balance_transaction_id is null
       and created_at > now() - interval '60 days'
     order by created_at desc limit ${limit}`;
  let n = 0;
  for (const r of rows) {
    const provider = getProvider(r.provider);
    if (!provider?.retrievePayment) continue;
    try {
      const v = await provider.retrievePayment(r.provider_payment_id);
      if (v.balance && (await recordPaymentFinancials(db, r.provider, r.provider_payment_id, v.balance))) n++;
    } catch (e) {
      logError(`payment financials sync failed (${r.provider})`, e);
    }
  }
  return n;
}
