import type { CartLineInput } from "./pricing";
import type { CurrencyCode } from "../money";
import { getSql, inTx, isDbConfigured, type Db } from "../db/client";

/**
 * Loads the user's persisted cart items from the database.
 */
export async function loadUserCart(userId: string): Promise<CartLineInput[]>;
export async function loadUserCart(db: Db, userId: string): Promise<CartLineInput[]>;
export async function loadUserCart(dbOrUserId: Db | string, maybeUserId?: string): Promise<CartLineInput[]> {
  const isDb = typeof dbOrUserId !== "string";
  const db = isDb ? (dbOrUserId as Db) : (isDbConfigured() ? getSql() : null);
  const userId = isDb ? maybeUserId! : (dbOrUserId as string);

  if (!db || !userId) return [];
  const rows = await db<{ variant_id: string; quantity: number }[]>`
    select ci.variant_id, ci.quantity
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    where c.user_id = ${userId}
  `;
  return rows.map((r) => ({ variantId: r.variant_id, quantity: Number(r.quantity) }));
}

/**
 * Saves the user's cart items atomically to public.carts and public.cart_items.
 */
export async function saveUserCart(userId: string, lines: CartLineInput[], currency?: CurrencyCode): Promise<void>;
export async function saveUserCart(db: Db, userId: string, lines: CartLineInput[], currency?: CurrencyCode): Promise<void>;
export async function saveUserCart(
  dbOrUserId: Db | string,
  userIdOrLines: string | CartLineInput[],
  linesOrCurrency?: CartLineInput[] | CurrencyCode,
  maybeCurrency?: CurrencyCode,
): Promise<void> {
  const isDb = typeof dbOrUserId !== "string";
  const db = isDb ? (dbOrUserId as Db) : (isDbConfigured() ? getSql() : null);
  const userId = isDb ? (userIdOrLines as string) : (dbOrUserId as string);
  const lines = isDb ? (linesOrCurrency as CartLineInput[]) : (userIdOrLines as CartLineInput[]);
  const currency: CurrencyCode = (isDb ? maybeCurrency : (linesOrCurrency as CurrencyCode)) || "EUR";

  if (!db || !userId) return;

  await inTx(db, async (tx) => {
    // Upsert the user's cart
    const [cart] = await tx<{ id: string }[]>`
      insert into public.carts (user_id, currency)
      values (${userId}, ${currency})
      on conflict (user_id) where user_id is not null
      do update set currency = excluded.currency, updated_at = now()
      returning id
    `;
    if (!cart) return;

    // Replace cart items with current list
    await tx`delete from public.cart_items where cart_id = ${cart.id}`;
    for (const l of lines) {
      if (l.quantity > 0) {
        await tx`
          insert into public.cart_items (cart_id, variant_id, quantity)
          values (${cart.id}, ${l.variantId}, ${Math.min(99, Math.max(1, l.quantity))})
          on conflict (cart_id, variant_id) do update set quantity = excluded.quantity
        `;
      }
    }
  });
}
