/**
 * Content of the "What's new / Coming soon" 3D board at the chained-off wing. Edit freely: "new" lists features
 * that are live in the store today; "soon" is the owner's roadmap (plans, not promises — keep wording honest).
 */
export interface UpdateItem {
  title: string;
  text: string;
}

export const UPDATES: { new: UpdateItem[]; soon: UpdateItem[] } = {
  new: [
    { title: "Shop together", text: "See other shoppers walk and fill their trolleys live." },
    { title: "Photo slideshows", text: "Product popups flip through every photo." },
    { title: "Voice in rooms", text: "Press V to talk with shoppers in your room." },
    { title: "EUR & USD prices", text: "Switch market for prices in your currency." },
  ],
  soon: [
    { title: "This new wing", text: "More aisles and departments open here." },
    { title: "Customer accounts", text: "Sign in, save addresses, see every order." },
    { title: "Real 3D products", text: "Inspect true-to-life models from every angle." },
  ],
};

/** Minimal gold icon drawn for each "On the way" feature (see UpdatesBoard). */
export type UpdateIcon = "levels" | "points" | "promo" | "coupon" | "gift";

/**
 * "On the way": the rewards season shown on the board's left wing. Announcements only; none of this is built yet,
 * so wording stays "on the way" (no dates, no amounts).
 */
export const ON_THE_WAY: (UpdateItem & { icon: UpdateIcon })[] = [
  { icon: "levels", title: "Levels & Progression", text: "Level up every time you shop, explore and play." },
  { icon: "points", title: "Loyalty Points & Rewards", text: "Earn points on every order. Unlock exclusive perks." },
  { icon: "promo", title: "Exclusive Promotions", text: "Members-only drops, seasonal deals, flash prices." },
  { icon: "coupon", title: "Coupons & Discount Codes", text: "Personal coupons and secret codes that save more." },
  { icon: "gift", title: "Giveaways & Special Events", text: "Live events, competitions and prizes up for grabs." },
];
