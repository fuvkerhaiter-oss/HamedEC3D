/**
 * STARTING-POINT legal texts for an EU (Italy-based) + US online store. They are templates, NOT legal advice:
 * fill every [BRACKETED] field and have a lawyer review before publishing. Format = CMS plain text
 * (blank line = paragraph, "# " = heading).
 */
export const LEGAL_PAGES: { slug: string; title: string; body: string }[] = [
  {
    slug: "terms",
    title: "Terms of Sale",
    body: `TEMPLATE — fill in the [bracketed] details and have it reviewed by a lawyer before publishing.

# 1. Who we are
These terms apply to purchases on [WEBSITE DOMAIN] ("WEGO SHIIIP"), operated by [LEGAL COMPANY NAME], [REGISTERED ADDRESS], VAT number [VAT NUMBER], company register [REGISTER + NUMBER], email [SUPPORT EMAIL].

# 2. Orders and contract
Product pages, the catalog and the 3D store are an invitation to order. When you click "Pay", you make an offer to buy. The contract is formed when we confirm your order by email after your payment has been received. We may refuse an order in case of obvious pricing errors, suspected fraud or stock that is no longer available; any amount paid is then refunded in full.

# 3. Prices and payment
Prices for customers in the EU are shown in euro and include VAT. Prices for customers in the United States are shown in US dollars; sales tax, where due, is added at checkout. Shipping costs are shown before you pay. Payment is processed by our payment provider [Stripe Payments Europe Ltd.]; we never see or store your full card details.

# 4. Delivery
We ship to the countries listed at checkout. Delivery times shown are estimates. Our products are shipped by [us / our partner suppliers] and may arrive in more than one parcel. See our Shipping policy for details. Risk passes to you when the goods are delivered to you.

# 5. Right of withdrawal (EU and UK consumers)
You may withdraw from this contract within 14 days without giving any reason. See our Returns policy for how to exercise this right, the return costs and the model withdrawal form.

# 6. Legal guarantee
EU consumers benefit from a legal guarantee of conformity of 2 years from delivery (Italian Consumer Code, articles 128 and following). If a product is defective or not as described, contact us and we will repair, replace or refund it as required by law.

# 7. Liability
Nothing in these terms limits your statutory rights as a consumer or our liability for death, personal injury, fraud or gross negligence.

# 8. The 3D store and voice chat
The 3D store is an optional way to browse. Shared rooms and voice chat must be used respectfully: no harassment, hate speech or illegal content. We may remove or block users who break these rules. Voice is not recorded by us (see Privacy Policy).

# 9. Disputes and applicable law
These terms are governed by [Italian] law. If you are a consumer, you keep the protection of the mandatory laws of your country of residence and may bring proceedings in your local courts. Contact us first at [SUPPORT EMAIL]; we aim to answer within 2 business days.`,
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    body: `TEMPLATE — fill in the [bracketed] details and have it reviewed by a lawyer before publishing.

# Controller
[LEGAL COMPANY NAME], [REGISTERED ADDRESS], email [PRIVACY EMAIL]. [Data protection officer, if appointed: NAME / EMAIL]

# What we collect and why
Orders: name, email, delivery address, phone (optional), items and amounts. Purpose: performing the contract, delivery, customer service, invoices. Legal basis: contract (GDPR art. 6(1)(b)) and legal obligations such as tax records (art. 6(1)(c)).

Payments: handled by [Stripe]. We receive the payment status and the last digits/type of card, never the full card number.

Emails: order confirmations and shipping updates (contract). We send marketing emails only if you opt in, and you can unsubscribe at any time.

3D store and shared rooms: the display name you choose, your avatar position and, only while you switch your microphone on, your voice. Voice and positions travel directly between the browsers in your room (peer-to-peer) and are not recorded or stored by us. Like any peer-to-peer connection, other shoppers' browsers can see your IP address. Legal basis: your use of the feature (art. 6(1)(b)) — the microphone is off by default.

Technical data: server logs (IP address, browser, time) for security, kept for [30] days. Legal basis: legitimate interest in keeping the service secure (art. 6(1)(f)).

# Who receives your data
Service providers acting on our instructions: hosting ([Vercel Inc.]), database ([Supabase Inc.]), payments ([Stripe]), email delivery ([Resend]), and the suppliers and carriers who prepare and deliver your order (name, address, phone). Some are located outside the EU; transfers rely on the EU–US Data Privacy Framework or Standard Contractual Clauses.

# How long we keep it
Order and invoice records: [10] years (Italian tax law). Customer-service messages: [2] years. Server logs: [30] days.

# Your rights
You can ask for access, correction, deletion, restriction, portability and object to processing at [PRIVACY EMAIL]. You can also complain to your data protection authority (in Italy: Garante per la protezione dei dati personali, www.garanteprivacy.it). US residents: we do not sell or share personal information for cross-context behavioral advertising.

# Cookies
See our Cookie Policy.`,
  },
  {
    slug: "returns",
    title: "Returns & Refunds",
    body: `TEMPLATE — fill in the [bracketed] details and have it reviewed by a lawyer before publishing.

# 14-day right of withdrawal (EU consumers)
You have the right to withdraw from your purchase within 14 days without giving any reason. The period ends 14 days after the day you (or someone you name, other than the carrier) receive the goods; for an order delivered in several parcels, after the last one arrives.

To withdraw, send us a clear statement by email to [RETURNS EMAIL] (you can use the model form below) before the 14 days end, with your order number.

# Sending the goods back
Send the goods back to [RETURN ADDRESS] within 14 days of telling us you are withdrawing. [You pay the direct cost of returning the goods / We pay the return shipping.] You are only liable for any loss in value caused by handling the goods beyond what is necessary to check them.

# Refunds
We refund all payments received from you, including the standard delivery cost, within 14 days of receiving your withdrawal. We may wait until we have received the goods back or you have shown proof of sending them, whichever is earlier. We use the same payment method you used, at no cost to you.

# Exceptions
The right of withdrawal does not apply to: perishable goods; sealed goods unsuitable for return for health or hygiene reasons once unsealed; goods made to your specifications. [Adapt to your products.]

# Damaged or wrong items
If something arrives damaged, defective or not as ordered, email [SUPPORT EMAIL] within [14] days with your order number and a photo. We will send a replacement or refund you, including shipping. This does not affect your 2-year legal guarantee.

# Model withdrawal form
To [LEGAL COMPANY NAME], [ADDRESS], [RETURNS EMAIL]:
I hereby give notice that I withdraw from my contract of sale of the following goods: [ ]
Ordered on [ ] / received on [ ] — Order number: [ ]
Name: [ ] — Address: [ ]
Date: [ ]`,
  },
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
