/**
 * Privacy Policy template (GDPR / Italian Privacy Code + US state privacy laws incl. CCPA/CPRA).
 * Written for how this store really works (Stripe, Supabase, Vercel, Resend, dropshipping suppliers,
 * peer-to-peer voice rooms). NOT legal advice: fill every [BRACKET], delete what does not apply, have a lawyer
 * review. CMS format: blank line = paragraph, "# " = heading, lines inside a paragraph keep their breaks.
 */
export const PRIVACY_BODY = `TEMPLATE — fill in every [bracketed] detail, remove anything that is not true for your business, and have it reviewed by a qualified lawyer before publishing.

This Privacy Policy explains what personal data WEGO SHIIIP collects, why we collect it, who we share it with, how long we keep it and the rights you have. We wrote it to be read, not to hide things: if something is unclear, write to [PRIVACY EMAIL] and a real person will answer.

# At a glance
• We collect only what we need to sell, deliver and support your order, keep the site secure and meet our legal duties.
• We never sell your personal data, and we do not use it for cross-context behavioural advertising.
• We never see or store your full card number. Payments are handled by Stripe.
• Your microphone in the 3D store is off by default. Voice is never recorded or stored by us.
• No advertising cookies, no tracking pixels, no third-party analytics.
• You can ask us at any time to see, correct, export or delete your data.

# 1. Who is responsible for your data
The data controller is [LEGAL COMPANY NAME], [REGISTERED ADDRESS], VAT number [VAT NUMBER] ("WEGO SHIIIP", "we", "us"). Contact for every privacy question: [PRIVACY EMAIL].
[If appointed: Data Protection Officer: NAME, EMAIL.]
[If you have no establishment in the EU: EU representative under GDPR article 27: NAME, ADDRESS, EMAIL.]

This policy applies to [WEBSITE DOMAIN], the online catalog, the 3D store, our emails and our customer service. It does not apply to third-party websites we link to.

# 2. What we collect, why, and on what legal basis
We explain each use separately so you can see exactly why each piece of data is needed. The legal bases come from article 6 of the EU General Data Protection Regulation (GDPR).

Placing and receiving an order
Data: full name, email address, delivery address, billing address, country, phone number (optional unless the carrier needs it), the products, quantities, prices, coupon used and any note you add to the order.
Why: to accept and process your order, have it prepared and delivered, send order and shipping emails, handle returns, refunds and warranty claims, and keep accounting records.
Legal basis: performance of the contract with you (art. 6(1)(b)) and our legal obligations under tax and accounting law (art. 6(1)(c)).

Payment
Data: payment status, amount, currency, the card brand, the last four digits and expiry of the card, the country of the card, and the payment and refund references created by our payment provider. Your full card number and security code go directly to Stripe and never reach our servers.
Why: to take payment, issue refunds, reconcile our accounts and handle disputes (chargebacks).
Legal basis: contract (art. 6(1)(b)) and legal obligations (art. 6(1)(c)).

Fraud prevention and security
Data: IP address, browser and device information, order and payment details, and fraud-risk signals produced by Stripe's fraud screening.
Why: to protect you and us from fraudulent payments, account abuse and attacks on the site, and to limit how many requests one connection can make.
Legal basis: our legitimate interest in preventing fraud and keeping the service secure (art. 6(1)(f)). Stripe may automatically decline a payment that its system judges high-risk. If this happens to you, contact us: a person will review the decision, you can explain your situation, and you can contest it.

Customer service
Data: what you send us through the contact form, by email or about an order (name, email, order number, message, photos of a damaged item).
Why: to answer you and solve the problem.
Legal basis: contract (art. 6(1)(b)) or, for general questions, our legitimate interest in answering the people who contact us (art. 6(1)(f)).

Order lookup and "my orders" links
Data: your email address and order number.
Why: so you can follow your orders without creating an account. We send a secure, time-limited link to the email used for the order, and only to that email.
Legal basis: contract (art. 6(1)(b)).

Product reviews
Data: the name or nickname you choose, your rating and your text, linked to your order.
Why: to publish genuine reviews from real customers. We check reviews before publishing them, and we publish negative reviews as well as positive ones.
Legal basis: your consent when you submit the review (art. 6(1)(a)). You can ask us to remove your review at any time.

The 3D store and shared rooms
Data: the display name you choose (you do not have to use your real name), your avatar colour, your position in the store, whether your microphone is on, the product IDs in your virtual trolley, and, only while you switch your microphone on, your voice.
How it works: to match you with other shoppers and connect you, short-lived presence and connection messages pass through our real-time service provider (Supabase). Your voice and your avatar's movements then travel directly between the browsers in your room (a peer-to-peer WebRTC connection). They are not routed through our servers and are not recorded or stored by us. Other shoppers in your room hear you while your microphone is on.
Important: like any peer-to-peer connection, the browsers of the other shoppers in your room can see your IP address, and so can the public connection-helper server (STUN server, operated by [Google LLC]) that browsers use to find a route to each other. If you do not want this, do not join a shared room or use the regular catalog.
Legal basis: your use of the feature you asked for (art. 6(1)(b)). The microphone is off until you switch it on, and your browser asks your permission first.
The figures labelled "demo bot" in the store are computer-controlled characters. They are not real people and they do not collect any data.

The "Who supported us from the beginning" wall
We show a name and a country on the supporters wall in the 3D store only with the clear consent of that person (art. 6(1)(a)). You can ask us to remove your name at any time and we will do so promptly.

Marketing emails
We send newsletters or offers only if you choose to receive them (art. 6(1)(a)) [or, where the law allows it, to existing customers about similar products, with an easy way to say no in every email (Italian Privacy Code art. 130(4))]. Every marketing email has a one-click unsubscribe link. Order and shipping emails are not marketing and are always sent.

Technical data and server logs
Data: IP address, date and time, the page requested, browser type and error information.
Why: to deliver the website, detect and fix errors, and defend against attacks.
Legal basis: legitimate interest (art. 6(1)(f)).

Legal claims and authorities
Where necessary, we use the relevant data to establish, exercise or defend legal claims and to answer lawful requests from public authorities (art. 6(1)(c) and (f)).

You are not obliged to give us your data, but without the data marked as required at checkout we cannot accept or deliver your order.

# 3. Children
Our store is not directed at children. You must be at least 18 years old, or the age of legal majority where you live, to place an order. We do not knowingly collect personal data from children under 16 (or under 14 in Italy, where national law sets that age for online services). If you believe a child has given us personal data, write to [PRIVACY EMAIL] and we will delete it.

# 4. Who receives your data
We never sell your personal data. We share it only with the parties below, only as far as each of them needs it, and only under contracts that require them to protect it.

Service providers acting on our instructions (processors):
• Hosting and website delivery: [Vercel Inc.], USA.
• Database, file storage and real-time connections: [Supabase Inc.], USA (data stored in [REGION]).
• Payments and fraud screening: [Stripe Payments Europe Ltd.], Ireland, and its affiliates. For some uses, such as fraud prevention and meeting its own legal duties, Stripe acts as an independent controller under its own privacy policy (stripe.com/privacy).
• Transactional email: [Resend], USA.

Order fulfilment partners:
• Our partner suppliers and marketplace platforms that prepare and ship your products (for example [AliExpress / NAMES]). They receive only what is needed to ship your order: your name, delivery address, phone number and the items ordered. Some of them are located outside the European Union, including in [China].
• Carriers and postal services that deliver the parcel and may contact you about delivery.

Others, only when necessary:
• Our accountants, auditors and legal advisers, under a duty of confidentiality.
• Tax authorities, courts, police or other public authorities, when the law requires it.
• A buyer or successor of our business, if the business or part of it is sold or merged. This policy will continue to protect your data.

# 5. Transfers outside the European Economic Area
Some of the recipients above are located outside the EEA. We transfer data only when it is protected as the GDPR requires:
• to the United States, to companies certified under the EU–US Data Privacy Framework, or under the European Commission's Standard Contractual Clauses;
• to other countries, under the Standard Contractual Clauses with additional safeguards where needed;
• for suppliers and carriers that must receive your delivery details in order to ship your products, the transfer is also necessary to perform the contract you asked for (GDPR art. 49(1)(b)).
You can ask us for a copy of the safeguards used for a transfer at [PRIVACY EMAIL].

# 6. How long we keep your data
We keep data only as long as we need it, then delete or anonymise it.
• Orders, invoices and payment records: [10] years from the end of the year of the order, as required by Italian tax and accounting law.
• Customer-service messages: [2] years after the matter is closed, or longer if needed for an open warranty or legal claim.
• Reviews and supporter-wall entries: until you ask us to remove them or we stop showing them.
• Marketing consent and the list of people who unsubscribed: until you withdraw consent, then only your email on a "do not contact" list so we respect your choice.
• Server and security logs: [30] days, unless needed to investigate an attack.
• 3D store presence data: only while you are connected. Voice is never stored.
• Data needed for a legal claim: until the claim is finally resolved.

# 7. How we protect your data
We use encrypted connections (HTTPS) everywhere, card data never touches our servers, access to the store dashboard is limited to authorised staff with personal accounts, permissions are limited by role, admin actions are logged, and our databases restrict what each user can read. No system is perfectly secure. If a personal data breach is likely to put you at risk, we will tell you and the competent authority as the law requires, without undue delay.

# 8. Your rights (EU, UK and EEA)
You have the right to:
• access the personal data we hold about you and get a copy;
• have inaccurate data corrected;
• have your data deleted, when we no longer need it or you withdraw consent (we may have to keep order records that tax law requires);
• restrict our use of your data in certain cases;
• receive your data in a portable, machine-readable format;
• object at any time to our use of your data based on legitimate interest, and always to direct marketing;
• withdraw any consent at any time, without affecting what we did before you withdrew it;
• not be subject to a decision based solely on automated processing that significantly affects you, and to ask for a human review.

To use your rights, write to [PRIVACY EMAIL]. We answer within one month (extendable by two months for complex requests, in which case we tell you why). It is free. We may ask you to confirm your identity, for example by writing from the email used for your order, so that nobody else can get your data.

You also have the right to complain to a data protection authority. In Italy this is the Garante per la protezione dei dati personali (www.garanteprivacy.it). You can also complain to the authority of the EU country where you live or work. We would appreciate the chance to solve the problem first.

# 9. Additional information for United States residents
This section applies to residents of US states with consumer privacy laws, including California (CCPA as amended by the CPRA), Virginia, Colorado, Connecticut, Utah, Texas, Oregon and others, to the extent those laws apply to us.

Categories of personal information we collected in the last 12 months: identifiers (name, email, postal address, phone number, IP address); customer records and commercial information (orders, payments, returns); internet and network activity (server logs, 3D store presence); audio information (live voice in the 3D store, only while your microphone is on, not recorded); and inferences used for fraud prevention. Sources: you, your browser, our payment provider and our carriers. Purposes: those described in section 2.

Sensitive personal information: we do not collect it, apart from the data needed to process a payment, and we do not use it to infer characteristics about you.

Selling and sharing: we do not sell personal information and we do not "share" it for cross-context behavioural advertising, as those terms are defined by California law. We have not done so in the last 12 months. We do not sell or share the personal information of consumers under 16. We honour the Global Privacy Control (GPC) browser signal as a request to opt out.

Your rights: depending on your state, you can ask to know what personal information we collect, use and disclose; to access and receive a copy of it; to correct it; to delete it; to opt out of sale, sharing, targeted advertising and profiling; and to limit the use of sensitive personal information. We will not discriminate against you for using these rights: you will not get a different price or a lower quality of service.

How to make a request: write to [PRIVACY EMAIL] [or call TOLL-FREE NUMBER, if required]. We will verify your request by matching information you give us with what we hold. You may use an authorised agent; we will ask for proof of the agent's authority and may ask you to confirm your identity directly. We answer within 45 days (extendable once by 45 days when reasonably necessary, with notice). If we refuse your request, you can appeal by replying to our answer with "Appeal" in the subject line; we will answer the appeal within the time your state's law requires, and if you are not satisfied you may contact your state Attorney General.

California "Shine the Light": we do not disclose personal information to third parties for their own direct marketing purposes.

# 10. Cookies and similar technologies
We use only storage that is strictly necessary for the site to work: your cart, region and currency, and 3D store settings saved in your browser, and a session cookie for our staff. Stripe sets its own necessary cookies on its payment page for fraud prevention. We do not use advertising or analytics cookies. If that ever changes, we will update this policy and ask for your consent first. Details: see our Cookie Policy.

# 11. Changes to this policy
We may update this policy when our services or the law change. The date at the bottom of this page shows the latest version. If we make important changes, we will make them clearly visible on the site and, where appropriate, tell you by email before they apply. We will never use data you gave us under an earlier version in a way that needs new consent without asking you first.

# 12. Contact
Privacy questions and requests: [PRIVACY EMAIL]
Post: [LEGAL COMPANY NAME], [REGISTERED ADDRESS]
Other questions about an order: [SUPPORT EMAIL]`;
