# Email to send to apps@ecwid.com

**Send from the store owner's email address** (marsadkoo@gmail.com), because
support will match it against the store.

---

**To:** apps@ecwid.com

**Subject:** Store 142682751 — custom app: "Internal problem has occurred" on both Reinstall and Create App

---

Hello,

I cannot apply access scopes to a custom app on my store, and I cannot create a
new custom app either. Both actions fail with the same message:

> Internal problem has occurred. Please contact support at apps@ecwid.com.

**Store ID:** 142682751
**Custom app namespace:** custom-app-142682751-1
**Control panel URL:** https://my.shopsettings.com/store/142682751#develop-apps
**Store registered:** 17 September 2026

### What I did

1. Opened Apps → Custom Apps → my app → Edit.
2. Added access scopes, including `create_orders`, `read_customers`,
   `create_customers` and `update_customers`. The scopes saved: the "Access
   scopes" field now lists 30 of them ("Read store profile, Update store
   profile, Update orders, Read orders, and 26 more").
3. A banner appeared at the top of the page: **"Reinstall the app to apply your
   scope changes"**, with the note "You edited the app access scopes. These
   changes will apply only after you reinstall the app."
4. I clicked the reinstall button, then **Install**. It failed with the
   internal-problem message. I tried a second time with the same result.
5. I regenerated the secret token and tried again — same result.
6. I then tried **Create App** to make a second custom app instead. That fails
   with the *same* internal-problem message, so no new app can be created
   either.

### What the API shows

The saved scopes are not in effect. With the current secret token:

| Request | Result |
|---|---|
| `GET /api/v3/142682751/profile` | 200 |
| `GET /api/v3/142682751/products?limit=1` | 200 |
| `GET /api/v3/142682751/orders?limit=1` | 200 |
| `POST /api/v3/142682751/orders` | **403** |
| `GET /api/v3/142682751/customers?limit=1` | **403** |
| `GET /api/v3/142682751/discount_coupons?limit=1` | **403** |
| `GET /api/v3/142682751/promotions?limit=1` | **403** |
| `GET /api/v3/142682751/reviews?limit=1` | **403** |
| `GET /api/v3/142682751/brands` | **403** |

So only `read_store_profile`, `read_catalog` and `read_orders` are effective —
which appear to be the app's original scopes. **None** of the scopes added in
step 2 works, not just the order and customer ones.

This is not a plan limitation as far as I can tell. `GET /profile` reports:

- `account.paid`: `true`
- `account.suspended`: `false`
- `account.availableFeatures` includes `API` (158 features in total)

### What I need

Either:

1. Apply the saved access scopes to custom app `custom-app-142682751-1` so
   that `create_orders`, `read_customers`, `create_customers` and
   `update_customers` take effect; **or**
2. Fix whatever prevents Create App from working, so I can create a new custom
   app with those scopes instead.

One more detail in case it is relevant: the control panel URL for this store
carries `?partner=tier_migration`, so the store may be part of a plan
migration.

Thank you,
[your name]

---

## What is blocked until they fix it

| | Status |
|---|---|
| Catalogue, prices, stock, categories | working |
| Advertisement banners | working |
| Reading order status from Ecwid | working |
| **Sending orders to Ecwid** | blocked — orders queue safely on the site |
| **Saving customer details in Ecwid** | blocked — accounts queue safely on the site |

Nothing is lost while waiting. Orders and customer records accumulate in a
queue and are sent automatically, within five minutes, once the permissions
work — or immediately, using the "Retry" and "Link them now" buttons in the
SADKO admin panel.
