/**
 * STARTING-POINT legal texts for an EU (Italy-based) + US online store. They are templates, NOT legal advice:
 * fill every [BRACKETED] field and have a lawyer review before publishing. Format = CMS plain text
 * (blank line = paragraph, "# " = heading).
 */
import { PRIVACY_BODY } from "./legal/privacy";
import { RETURNS_BODY } from "./legal/returns";
import { TERMS_BODY } from "./legal/terms";

export const LEGAL_PAGES: { slug: string; title: string; body: string }[] = [
  // Full texts live in ./legal/*.ts (long; reviewed separately).
  { slug: "terms", title: "Terms of Sale", body: TERMS_BODY },
  { slug: "privacy", title: "Privacy Policy", body: PRIVACY_BODY },
  { slug: "returns", title: "Returns & Refunds", body: RETURNS_BODY },
  {
    slug: "shipping",
    title: "Shipping",
    body: `TEMPLATE — fill in the [bracketed] details before publishing.

# Where we ship
We currently deliver to the countries listed at checkout (European Union and United States).

# Costs and times
Shipping options, prices and estimated delivery times for your address are shown at checkout before you pay. [Free shipping on orders over AMOUNT.] Orders are usually prepared within [1–3] business days.

# Tracking
As soon as your order ships we email you the carrier and tracking number. You can also follow your order with the link in your confirmation email.

# Multiple parcels
Products may come from different warehouses and arrive in separate parcels at no extra cost.

# Customs (outside the EU)
For deliveries to the United States, [duties and import taxes are included / may be charged by the carrier on delivery].

# Problems
Parcel late, lost or damaged? Email [SUPPORT EMAIL] with your order number and we will sort it out.`,
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    body: `TEMPLATE — review before publishing. Update this page (and add a consent banner) BEFORE adding any analytics or advertising tools.

# What we use
We only use storage that is strictly necessary for the site to work, so no consent is required:

Cart and preferences (your browser's local storage): the items in your cart, your region/currency, music and display name settings in the 3D store.

Admin session cookie: only for our staff who log in to the store dashboard.

Payment: when you pay, our payment provider [Stripe] sets its own necessary cookies for fraud prevention on its payment page.

# What we don't use
No advertising cookies, no tracking pixels, no third-party analytics. [If you add any, list them here and ask for consent first.]

# Managing storage
You can delete this data at any time in your browser settings; your cart will then be emptied.`,
  },
  {
    slug: "legal-notice",
    title: "Legal Notice",
    body: `TEMPLATE — fill in before publishing.

[LEGAL COMPANY NAME]
[REGISTERED ADDRESS]
VAT number: [VAT NUMBER]
Company register: [REGISTER + NUMBER] — Share capital: [AMOUNT, if applicable]
Email: [SUPPORT EMAIL] — Phone: [PHONE]
Certified email (PEC): [PEC ADDRESS]

Responsible for content: [NAME]`,
  },
  {
    // Trust page for customers and search engines. Only true statements: replace every [bracket], delete
    // anything that is not true for the business, never add invented awards, numbers or testimonials.
    slug: "about",
    title: "About WEGO SHIIIP",
    body: `TEMPLATE — replace every [bracketed] part with true details, remove what does not apply, then publish.

WEGO SHIIIP is an online store based in [CITY], Italy, run by [LEGAL COMPANY NAME]. Our motto is "Happy Family, Happy Animals": [ONE OR TWO SENTENCES IN YOUR OWN WORDS ABOUT WHY YOU STARTED THE SHOP AND WHO IT IS FOR].

# Two ways to shop
You can browse our catalog like any online store, or walk the aisles of our interactive 3D supermarket right in your browser, on a computer or a phone. Both show the same products, prices and stock, and share the same cart.

# What we sell
[DESCRIBE THE PRODUCT RANGE YOU REALLY STOCK, E.G. THE DEPARTMENTS IN THE CATALOG.]

# Where we deliver
We deliver to the European Union (prices in euro, VAT included) and the United States (prices in US dollars, sales tax added at checkout where due). [SAY WHO SHIPS THE ORDERS: YOU, OR PARTNER SUPPLIERS, AND FROM WHERE.] Delivery options and times for your address are shown at checkout before you pay.

# Contact
Questions about an order or a product? Use our Help & contact page or write to [SUPPORT EMAIL]. [REGISTERED ADDRESS / VAT NUMBER, AS IN THE LEGAL NOTICE.]`,
  },
];
