/**
 * Controlled order lifecycle. All status changes must go through `transitionOrder`
 * so invalid transitions are rejected and every change produces an audit entry.
 */

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "submitted_to_supplier",
  "supplier_accepted",
  "shipped",
  "delivered",
  "cancelled",
  "refund_requested",
  "refunded",
  "failed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ["paid", "cancelled", "failed"],
  paid: ["processing", "refund_requested"],
  processing: ["submitted_to_supplier", "failed", "refund_requested"],
  submitted_to_supplier: ["supplier_accepted", "failed", "refund_requested"],
  supplier_accepted: ["shipped", "refund_requested"],
  shipped: ["delivered", "refund_requested"],
  delivered: ["refund_requested"],
  refund_requested: ["refunded"],
  failed: ["processing", "refund_requested", "cancelled"],
  cancelled: [],
  refunded: [],
};

export type ActorType = "system" | "admin" | "customer" | "payment_webhook" | "supplier_sync";

export interface TransitionEvidence {
  /** Required to move to `paid`: a server-verified payment reference. */
  verifiedPaymentId?: string;
  /** Required to move to `submitted_to_supplier`. */
  supplierOrderRef?: string;
  /** Required to move to `shipped`: tracking confirmed by the supplier/carrier. */
  trackingNumber?: string;
  carrier?: string;
}

export interface TransitionRequest {
  from: OrderStatus;
  to: OrderStatus;
  actor: { type: ActorType; id?: string };
  reason?: string;
  evidence?: TransitionEvidence;
  at?: Date;
}

export interface OrderAuditEntry {
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  evidence: TransitionEvidence;
  createdAt: string;
}

export class InvalidTransitionError extends Error {
  override name = "InvalidTransitionError";
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Who may trigger which target statuses. Customers can only cancel unpaid orders or request refunds. */
const ACTOR_ALLOWED_TARGETS: Readonly<Record<ActorType, ReadonlySet<OrderStatus> | "any">> = {
  system: "any",
  admin: "any",
  customer: new Set<OrderStatus>(["cancelled", "refund_requested"]),
  // cancelled: only from pending_payment (transition table), when the provider reports the checkout expired unpaid.
  payment_webhook: new Set<OrderStatus>(["paid", "failed", "refunded", "cancelled"]),
  supplier_sync: new Set<OrderStatus>(["supplier_accepted", "shipped", "delivered", "failed"]),
};

export function transitionOrder(req: TransitionRequest): OrderAuditEntry {
  const { from, to, actor } = req;
  const evidence = req.evidence ?? {};

  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(`Order cannot move from ${from} to ${to}`);
  }

  const allowed = ACTOR_ALLOWED_TARGETS[actor.type];
  if (allowed !== "any" && !allowed.has(to)) {
    throw new InvalidTransitionError(`Actor ${actor.type} may not set status ${to}`);
  }
  if (actor.type === "customer" && to === "cancelled" && from !== "pending_payment") {
    throw new InvalidTransitionError("Customers may only cancel orders awaiting payment");
  }

  if (to === "paid" && !evidence.verifiedPaymentId) {
    throw new InvalidTransitionError("Moving to paid requires a server-verified payment id");
  }
  if (to === "submitted_to_supplier" && !evidence.supplierOrderRef) {
    throw new InvalidTransitionError("Moving to submitted_to_supplier requires a supplier order reference");
  }
  if (to === "shipped" && (!evidence.trackingNumber || !evidence.carrier)) {
    throw new InvalidTransitionError("Moving to shipped requires confirmed tracking number and carrier");
  }

  return {
    fromStatus: from,
    toStatus: to,
    actorType: actor.type,
    actorId: actor.id ?? null,
    reason: req.reason ?? null,
    evidence,
    createdAt: (req.at ?? new Date()).toISOString(),
  };
}
