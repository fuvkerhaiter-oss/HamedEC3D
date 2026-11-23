import { getSql, isDbConfigured, inTx, type Db } from "../db/client";

export interface CustomerAddress {
  id: string;
  userId: string;
  fullName: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface AddressInput {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}

function resolveDb(dbOrUserId: Db | string, maybeUserId?: string): { db: Db | null; userId: string } {
  if (typeof dbOrUserId === "string") {
    return { db: isDbConfigured() ? getSql() : null, userId: dbOrUserId };
  }
  return { db: dbOrUserId, userId: maybeUserId ?? "" };
}

export async function listCustomerAddresses(userId: string): Promise<CustomerAddress[]>;
export async function listCustomerAddresses(db: Db, userId: string): Promise<CustomerAddress[]>;
export async function listCustomerAddresses(dbOrUserId: Db | string, maybeUserId?: string): Promise<CustomerAddress[]> {
  const { db, userId } = resolveDb(dbOrUserId, maybeUserId);
  if (!db || !userId) return [];

  const rows = await db<{
    id: string; user_id: string; full_name: string; line1: string; line2: string | null;
    city: string; region: string | null; postal_code: string; country: string;
    phone: string | null; is_default: boolean; created_at: Date;
  }[]>`
    select id, user_id, full_name, line1, line2, city, region, postal_code, country, phone, is_default, created_at
    from public.addresses
    where user_id = ${userId}
    order by is_default desc, created_at desc
  `;

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    fullName: r.full_name,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    region: r.region,
    postalCode: r.postal_code,
    country: r.country,
    phone: r.phone,
    isDefault: r.is_default,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addCustomerAddress(userId: string, input: AddressInput): Promise<string | null>;
export async function addCustomerAddress(db: Db, userId: string, input: AddressInput): Promise<string | null>;
export async function addCustomerAddress(dbOrUserId: Db | string, userIdOrInput: string | AddressInput, maybeInput?: AddressInput): Promise<string | null> {
  const isFirstArgDb = typeof dbOrUserId !== "string";
  const db = isFirstArgDb ? (dbOrUserId as Db) : (isDbConfigured() ? getSql() : null);
  const userId = isFirstArgDb ? (userIdOrInput as string) : (dbOrUserId as string);
  const input = isFirstArgDb ? maybeInput! : (userIdOrInput as AddressInput);

  if (!db || !userId) return null;

  return inTx(db, async (tx) => {
    if (input.isDefault) {
      await tx`update public.addresses set is_default = false where user_id = ${userId}`;
    }
    const [row] = await tx<{ id: string }[]>`
      insert into public.addresses (user_id, full_name, line1, line2, city, region, postal_code, country, phone, is_default)
      values (${userId}, ${input.fullName.trim()}, ${input.line1.trim()}, ${input.line2?.trim() || null},
        ${input.city.trim()}, ${input.region?.trim() || null}, ${input.postalCode.trim()},
        ${input.country.trim().toUpperCase()}, ${input.phone?.trim() || null}, ${Boolean(input.isDefault)})
      returning id
    `;
    return row?.id ?? null;
  });
}

export async function deleteCustomerAddress(userId: string, addressId: string): Promise<boolean>;
export async function deleteCustomerAddress(db: Db, userId: string, addressId: string): Promise<boolean>;
export async function deleteCustomerAddress(dbOrUserId: Db | string, userIdOrAddrId: string, maybeAddrId?: string): Promise<boolean> {
  const isFirstArgDb = typeof dbOrUserId !== "string";
  const db = isFirstArgDb ? (dbOrUserId as Db) : (isDbConfigured() ? getSql() : null);
  const userId = isFirstArgDb ? userIdOrAddrId : (dbOrUserId as string);
  const addressId = isFirstArgDb ? maybeAddrId! : userIdOrAddrId;

  if (!db || !userId || !addressId) return false;
  const res = await db`
    delete from public.addresses where id = ${addressId} and user_id = ${userId}
  `;
  return res.count > 0;
}

export async function setDefaultCustomerAddress(userId: string, addressId: string): Promise<boolean>;
export async function setDefaultCustomerAddress(db: Db, userId: string, addressId: string): Promise<boolean>;
export async function setDefaultCustomerAddress(dbOrUserId: Db | string, userIdOrAddrId: string, maybeAddrId?: string): Promise<boolean> {
  const isFirstArgDb = typeof dbOrUserId !== "string";
  const db = isFirstArgDb ? (dbOrUserId as Db) : (isDbConfigured() ? getSql() : null);
  const userId = isFirstArgDb ? userIdOrAddrId : (dbOrUserId as string);
  const addressId = isFirstArgDb ? maybeAddrId! : userIdOrAddrId;

  if (!db || !userId || !addressId) return false;
  return inTx(db, async (tx) => {
    await tx`update public.addresses set is_default = false where user_id = ${userId}`;
    const res = await tx`update public.addresses set is_default = true where id = ${addressId} and user_id = ${userId}`;
    return res.count > 0;
  });
}
