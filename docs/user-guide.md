# Ensoftic POS — User guide

A step-by-step guide for shop owners, managers and cashiers. It follows the order you
would use the system in: first setup, adding products and stock, selling, the end of
the day, and the work that follows.

> **Trying it on your own computer?** Open <http://localhost:5180>. Demo sign-ins (password
> `Demo-Shop-2026!` for all three):
>
> - `owner@demo.lk`
> - `manager@demo.lk`
> - `cashier@demo.lk`
>
> E-mails the system sends (confirmations, password resets, invitations, customer
> messages) appear at <http://localhost:8026>.

---

## Contents

1. [Who can do what](#1-who-can-do-what)
2. [Create your business account](#2-create-your-business-account)
3. [Set up the business](#3-set-up-the-business)
4. [Add staff](#4-add-staff)
5. [Add products](#5-add-products)
6. [Buy and receive stock](#6-buy-and-receive-stock)
7. [Look after stock](#7-look-after-stock)
8. [Selling at the till](#8-selling-at-the-till)
9. [Customers, credit and loyalty points](#9-customers-credit-and-loyalty-points)
10. [Returns, exchanges and voids](#10-returns-exchanges-and-voids)
11. [Closing the day](#11-closing-the-day)
12. [Selling without internet](#12-selling-without-internet)
13. [Reports and the dashboard](#13-reports-and-the-dashboard)
14. [Messages to customers](#14-messages-to-customers)
15. [Notifications and the activity log](#15-notifications-and-the-activity-log)
16. [Your plan and payment](#16-your-plan-and-payment)
17. [The Android app](#17-the-android-app)
18. [Languages](#18-languages)
19. [Questions and problems](#19-questions-and-problems)

---

## 1. Who can do what

Every person signs in with their own e-mail and password. What they see depends on their role.

| Role            | Can do                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Owner**       | Everything, including business settings, staff, devices, and plan and billing                                                                                                  |
| **Manager**     | Products, stock, purchasing, selling, returns, approvals, cash, customers and credit, customer messages, reports (including profit), and staff (cashiers and stock staff only) |
| **Cashier**     | Selling, returns, their own shift's cash, finding and adding customers, and collecting account payments                                                                        |
| **Stock staff** | Products, receiving, adjustments, transfers, stock counts and purchasing                                                                                                       |

Staff can also be limited to certain branches (see [Add staff](#4-add-staff)).

---

## 2. Create your business account

1. Open the web app and choose **Create account**.
2. Enter:
   - the **business name**;
   - your **full name**;
   - your **work e-mail**;
   - a **password** of at least 12 characters (a few unrelated words work well).
3. Tick that you agree to the terms, then press **Create account**.
4. **Confirm your e-mail.** Open the message the system sends and click the link. A banner
   reminds you until you do.
5. **Choose your business type**, then press **Finish setup**:
   - **Cosmetics:** batch numbers and expiry dates; shade and size options.
   - **Textiles & clothing:** sizes and colours; selling by the metre or yard.
   - **General retail:** simple items.

   This only sets sensible starting options; you can change them all later under
   **Settings**.

New businesses start with a free trial (see [Your plan and payment](#16-your-plan-and-payment)).

---

## 3. Set up the business

Open **Settings** in the menu. Only the owner can change most of these pages.

| Tab                      | What to set                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Business**             | Legal name, tax registration number, address (these print on receipts)                                                                                                |
| **Currency & language**  | Currency (LKR), time zone, and the languages staff may use                                                                                                            |
| **Product options**      | Track batch numbers and expiry dates, allow part quantities (e.g. 2.5 m), which options products have (colour, size, shade, ...), units (piece, metre, kilogram, ...) |
| **Branches & registers** | Your shops (branches) and the tills (registers) in each                                                                                                               |
| **Taxes & checkout**     | Tax rates (e.g. VAT 18 %), see below                                                                                                                                  |
| **Staff**                | People and their roles                                                                                                                                                |
| **Devices**              | Android tills signed in to your business                                                                                                                              |
| **Plan & billing**       | Your plan, trial and invoices                                                                                                                                         |

### Taxes & checkout

- **Tax rates:** add each rate you charge and mark one as the default. A product can use
  a different rate, or none.
- **Prices include tax:**
  - switch it on if your shelf prices already contain VAT (the receipt shows the tax
    inside the price);
  - switch it off if tax is added at the till.
- **Selling without stock:** whether the till may sell items it has no recorded stock for.
- **Discounts that need a manager:** above what share of a sale a discount needs a
  manager's approval. Leave it empty if never.
- **Refunds need approval:** whether returns need a manager.
- **Receipt footer:** a line printed at the bottom of every receipt, e.g. your exchange
  policy.
- **Loyalty points:** switch on, then set how much a customer spends to earn one point,
  what a point is worth when paying, and the fewest points that can be used at once.

---

## 4. Add staff

**Settings › Staff › Invite staff**

1. Enter the person's e-mail and choose their **role**.
2. Optionally choose the **branches** they may work at (leave empty for all branches).
3. Press **Send invitation**. They receive an e-mail and click it to set their name and
   password; the link works for 7 days.

You can change a person's role or branches, or disable them, at any time. Owners can manage
everyone; managers can manage cashiers and stock staff. Your plan sets how many staff,
branches, registers and devices you can have.

---

## 5. Add products

**Products › Add product**

1. Enter the **product name**, and optionally the brand, category, unit and tax rate.
2. Add one or more **variants**, one per sellable version (e.g. Red / M, Red / L).
   - Each has a **SKU** (your own code), an optional **barcode**, a **selling price** and
     an optional **cost price**.
   - Variant options (colour, size, shade) come from **Settings › Product options**.
3. Press **Save product**.

**Also on the products pages**

- **Photos:** on a product's page, use **Photos › Add photos** (JPEG, PNG or WebP, up to
  8). The first photo is the main one; use **Make main** to change it. Photos appear in
  the product list and when searching at the till.
- **Categories:** **Products › Categories** groups products (e.g. Sarees › Silk sarees)
  for searching and reports.
- **Many products at once:** **Products › Import**.
  1. Download the CSV template, fill it in Excel, then upload it.
  2. The system checks every row first and lists any problems by line. Nothing is saved
     until you confirm.
  3. **Export** gives you all products as CSV.
- **Archive:** an item you no longer sell is archived, not deleted, so its history stays.

---

## 6. Buy and receive stock

### Suppliers and purchase orders (optional)

1. **Purchasing › Suppliers:** add the companies you buy from.
2. **Purchasing › Orders › New order:**
   1. choose the supplier and the branch to deliver to;
   2. add items with quantities and costs, then **Save draft**;
   3. send the order to the supplier yourself (by phone, e-mail or print), then press
      **Mark as sent to supplier**.
3. When the goods arrive, open the order and choose **Receive against this order**. You can
   receive part of an order; it stays open for the rest.

### Receiving without an order

**Inventory › Receive stock**

1. Choose the branch and, optionally, the supplier.
2. Scan or search each item and enter the quantity and the **unit cost**.
3. Cosmetics and other batch-tracked items: enter the **batch number** and **expiry date**.
4. Press **Receive**. Stock goes up, and the item's average cost is updated (used for profit
   reports).

---

## 7. Look after stock

**Inventory** shows the stock of every item per branch. Low stock and soon-to-expire batches
are marked; open an item to see every movement (received, sold, returned, adjusted, ...).

| Task                                                         | Where                        | Notes                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Write off damaged, expired or lost stock, or add found items | **Inventory › Adjust stock** | Choose a reason (Damaged, Expired, Lost, Theft, Found, ...). Use a minus sign to remove stock. Every adjustment is recorded |
| Move stock between branches                                  | **Inventory › Transfers**    | Send from one branch; the other branch **receives** it. Until then the stock is "in transit"                                |
| Count the shelves                                            | **Inventory › Stock counts** | Start a count, enter what you find, then **complete** it. The system corrects stock to your count and shows the differences |
| Reorder levels                                               | Product page, per variant    | Items at or below this level show as low stock and appear in the morning notification                                       |

**Expired stock (cosmetics):**

- The till never sells from a batch that has passed its expiry date while fresh stock is
  left.
- If only expired stock is left, the sale is refused with a message. Check the date on the
  item, then write the expired stock off under **Adjust stock › Expired**.

---

## 8. Selling at the till

**Sell** in the menu (web), or **Sell** in the Android app.

### Open a shift

Each register works in **shifts**. Press **Open shift** and enter the **opening float**, the
cash in the drawer at the start. Every sale and cash movement belongs to the shift until you
close it.

### Make a sale

1. **Add items** in **Scan or search items**. Any of these works:
   - scan the barcode;
   - type the SKU and press Enter;
   - type part of the name and choose from the list.
2. **Change the quantity** in the cart. Part quantities, such as 2.5 m of fabric, work when
   the unit allows them.
3. **Discounts** (if you are allowed to give them):
   - on a **line**: a percentage or an amount on one item;
   - **Sale discount**: on the whole sale.

   Above the business's limit, a manager approves on the spot by entering their e-mail and
   password in the box that appears.

4. **Customer** (optional): press **Add customer** and find them by phone number. This is
   needed for paying **on account** and for **loyalty points**.
5. **Payments:** choose the **method** and enter the **amount**.
   - **Exact** fills in the amount due.
   - For cash, type what the customer gives you; the **change** is shown.
   - **Add payment** splits the payment, e.g. part cash, part card.
   - **Card** and **bank transfer**: add the reference from the card machine or bank if you
     like. Card numbers are never stored.
   - **On account**: the amount goes onto the customer's account, within their credit
     limit.
   - **Points**: when loyalty is on and the customer has enough points, use
     **Use LKR … in points**.
6. **Complete sale** becomes available once the payments cover the total (**Still due**
   reaches zero). Press it.
7. The **receipt** appears:
   - press **Print** for the shop's printer;
   - on Android, press **Print receipt** for a Bluetooth receipt printer (see
     [The Android app](#17-the-android-app));
   - then press **New sale** for the next customer.

### Cash in / out

**Cash in / out** records money put into or taken out of the drawer without a sale, e.g.
change brought from the bank or a payment to a supplier. Give a short reason; it counts in
the shift's cash.

---

## 9. Customers, credit and loyalty points

**Customers › Add customer**

- **Details:** name, phone (used to find them at the till), e-mail and address.
- **Agrees to receive offers and news:** tick only when the customer says yes. Note how they
  agreed (e.g. "Asked at the till"). Every change is kept in the customer's **consent
  history**.
- **Credit limit:** set by managers. It is the most the customer may owe; 0 means no buying
  on account.

### On the customer's page

- **Balance and statement:**
  - what they owe, with every sale on account and payment;
  - choose dates and **print** the statement.
- **Record payment:** money received against their account. Cash goes into your open shift.
- **Loyalty points:**
  - the balance and the history of points earned, used and adjusted;
  - managers can **adjust** points with a reason.
  - Customers earn points on what they pay (not on the part paid with points). Returns give
    back used points and take back earned points.
- **Purchase history:** their sales.
- **Messages consent:** whether they agreed, since when, and every change.

---

## 10. Returns, exchanges and voids

1. **Sales:** find the sale by its receipt number (e.g. INV-000123) or browse the list, then
   open it.
2. **Return items:**
   1. choose the items and quantities coming back;
   2. choose how to refund: the original payment methods, cash, or store credit;
   3. if your settings require it, a manager approves.

   Stock goes back up. A sale can be returned in several parts.

3. **Void sale:** cancels a whole sale from the open shift, e.g. a mistake just made. It needs
   a manager and a reason.

**For an exchange:** return the old item, then sell the new one, using the refund or store
credit as payment.

---

## 11. Closing the day

**Close shift**

1. Count the cash in the drawer and enter the **counted cash**.
2. The system shows what was expected (opening float + cash sales − cash refunds ± cash
   in/out) and the **difference**.
3. Confirm. The **shift report (Z report)** is ready to print under **Reports › Shift
   reports**: sales by payment method, refunds, discounts, tax, cash movements and the cash
   count.

A cashier closes their own shift; managers can close anyone's.

---

## 12. Selling without internet

If the connection drops, the till **keeps selling** from its own copy of the catalogue:

- **While offline:**
  - sales are saved on the device and marked as waiting;
  - the receipt shows a "pending" number until the sale reaches the server.
- **When the connection returns:** waiting sales are sent automatically, and each gets its
  real number.
- **Not possible offline:** paying with **loyalty points** (the balance can't be checked).
  Paying on account is allowed and checked later.
- **Differences found when the sale arrives are listed for a manager** under **Sales ›
  Offline sales to review**, for example:
  - a price changed meanwhile;
  - stock was short;
  - the shift was already closed;
  - a discount wasn't approved;
  - an expired batch was sold;
  - the customer went over their credit limit.

  The manager checks each one and marks it resolved with a note.

---

## 13. Reports and the dashboard

**Dashboard:** today's and this week's sales, the best-selling items today, low stock, open
shifts, offline sales to review, and money owed by customers.

**Reports** (choose dates and branch; **Export CSV** opens in Excel):

| Tab                   | Shows                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| **Sales**             | By day, branch, cashier, category, product or payment method, after returns |
| **Tax**               | Taxable amounts and tax collected per rate, for your tax return             |
| **Profit**            | Sales minus cost of goods (managers and owners only)                        |
| **Stock value**       | What your stock is worth at cost                                            |
| **Customer balances** | Who owes how much, by age (0–30, 31–60, 61–90, over 90 days)                |
| **Shift reports**     | Every shift's Z report                                                      |

Staff limited to some branches see only those branches.

---

## 14. Messages to customers

**Customers › Customer messages** (owners and managers)

1. **Choose the channel.** The count beside it shows how many customers will receive the
   message:
   - **E-mail:** customers who agreed and have an e-mail address.
   - **SMS:** customers who agreed and have a Sri Lankan mobile number.
2. **Write the message.**
   - `{name}` is replaced by the customer's first name.
   - For SMS, the counter shows the characters and SMS parts per customer. Sinhala and
     Tamil use shorter parts.
3. **Check the preview**, then press **Send to … customers** and confirm. Messages go out in the
   background; the list below shows sent, waiting, failed and skipped.

**Rules that protect your customers and your shop**

- Only customers who **agreed** receive messages.
- Every message has a **link to stop messages**. When a customer uses it, they are removed
  at once, and this is recorded in their consent history.
- SMS per month are limited by your plan.
- SMS works once the service has an SMS provider (Notify.lk) set up. Until then only e-mail
  is offered.

---

## 15. Notifications and the activity log

- **Notifications** (the bell at the top):
  - each morning: low stock and soon-to-expire batches for your branches;
  - yesterday's sales summary for owners and managers;
  - offline sale differences and plan reminders.

  Open one to go to the related page. Owners and managers can also get a morning e-mail;
  switch it off on the Notifications page.

- **Activity log** (owners and managers): who did what and when. Every sign-in, price
  change, return, approval, stock adjustment, staff change and support access is recorded.

---

## 16. Your plan and payment

**Settings › Plan & billing** (owner)

- **Trial:**
  - new businesses start with a free trial;
  - the page shows the days left, and what the plan includes (branches, registers, staff,
    devices, SMS per month).
- **Paying:**
  1. choose a plan and monthly or yearly billing;
  2. press **Pay for (plan)**: you are taken to PayHere's secure page;
  3. after payment you return and the invoice shows as paid.

  Card details are entered only on PayHere's page, never in Ensoftic POS.

- **If a payment is missed:** after a short grace period the account becomes **read-only**.
  You can still see and export everything, but not sell or change data, until the plan is
  paid.

---

## 17. The Android app

For tills on phones and tablets.

1. **Sign in** with your own e-mail and password.
2. **Choose the register:** pick the branch and register this device works at (once per
   device). The device appears under **Settings › Devices**, where an owner can revoke it if
   it is lost.
3. **Sell:**
   - scan barcodes with the **camera**, or use a connected scanner;
   - the rest works like the web till: customer, discounts, payments, points, receipt;
   - works offline as described in [Selling without internet](#12-selling-without-internet).
4. **Price check:** scan an item to see its photo, price and stock at your branch.
5. **Receipt printer:** **Home › Receipt printer**.
   1. Switch the printer on, press **Find printers** and choose yours.
   2. Choose the **paper width** (58 or 80 mm).
   3. Press **Print a test page**: the frame should fill the paper width.
   4. Optionally switch on **Print every receipt automatically**.

   It works with Bluetooth LE ESC/POS receipt printers; Sinhala and Tamil print correctly.
   Allow "Nearby devices" when Android asks.

6. **Shift and cash:** open and close shifts and record cash in/out on the device.

---

## 18. Languages

The app is available in **English, Sinhala and Tamil**. Use **Language** at the top of any
page; your choice is remembered on that device. The owner chooses which languages are
offered and the default under **Settings › Currency & language**.

---

## 19. Questions and problems

**"Complete sale" is greyed out.**

- The payment doesn't cover the total yet. Enter the amount or press **Exact** until
  **Still due** shows zero.
- Also check that every quantity is valid.

**A sale says "Only expired stock … is left".**

- The only stock on record has expired.
- Check the item's date and write expired stock off (**Inventory › Adjust stock ›
  Expired**). If you have fresh stock that was never received, receive it first.

**"This needs a manager's approval".**

- The discount or refund is above your business's limit.
- A manager enters their e-mail and password in the box shown. Their approval is recorded.

**I can't change something / a menu is missing.**

- Your role doesn't include it (see [Who can do what](#1-who-can-do-what)). Ask the owner
  or a manager.

**The account is read-only.**

- The plan's payment is overdue. The owner pays under **Settings › Plan & billing**.

**I forgot my password.**

- On the sign-in page choose **Forgot password**. The link in the e-mail is valid for a
  short time and works once.
- After too many wrong passwords the account locks for a few minutes. Wait, or reset the
  password.

**The till went offline.**

- Keep selling; sales are sent when the connection returns.
- Afterwards, a manager checks **Sales › Offline sales to review**.

**The receipt printer doesn't print.**

- Bluetooth is on and "Nearby devices" is allowed for the app.
- The printer is on, nearby, and not connected to another phone.
- **Print a test page** under **Receipt printer**. If the frame is cut off, choose the
  smaller paper width.
