---
routes:
  - /ثلاجات/     # /%d8%ab%d9%84%d8%a7%d8%ac%d8%a7%d8%aa/
  - /فريزرات/    # /%d9%81%d8%b1%d9%8a%d8%b2%d8%b1%d8%a7%d8%aa/
  - /أفران/      # /%d8%a3%d9%81%d8%b1%d8%a7%d9%86/
  - /غسالات/     # /%d8%ba%d8%b3%d8%a7%d9%84%d8%a7%d8%aa/
type: wordpress-post
taxonomy: /category/technology/
editable: true
rebrandPriority: 8
---

# Arabic category posts (4)

Four WordPress **posts** with Arabic slugs, filed under the `technology` category. They sit outside `/shop/` but **render the same Ecwid catalog widget** rather than editorial content.

## Routes

| Arabic slug | Encoded path | Title | English |
|---|---|---|---|
| ثلاجات | `/%d8%ab%d9%84%d8%a7%d8%ac%d8%a7%d8%aa/` | `ثلاجات \| SADKO Group` | Refrigerators |
| فريزرات | `/%d9%81%d8%b1%d9%8a%d8%b2%d8%b1%d8%a7%d8%aa/` | `فريزرات \| SADKO Group` | Freezers |
| أفران | `/%d8%a3%d9%81%d8%b1%d8%a7%d9%86/` | `أفران \| SADKO Group` | Ovens |
| غسالات | `/%d8%ba%d8%b3%d8%a7%d9%84%d8%a7%d8%aa/` | `غسالات \| SADKO Group` | Washing Machines |

Plus the archive: `/category/technology/`

## Observed content (identical across all four)
- Global Divi header and footer
- The page **title** is the only unique element
- A left sidebar of category filters (all 12 top-level categories)
- Sort dropdown (We recommend · Newest arrivals · price · alphabetical)
- An **"Featured Products"** grid — the *same* 25+ products on every one of the four posts
- No article body, no author byline, no publish date, no featured image, no buying guidance

## The problem

These four posts are **duplicate-content shells**. They:
- Duplicate `/shop/` and the Ecwid category routes with different URLs
- Show the *same* featured products regardless of which appliance the slug names — the `أفران` (Ovens) post lists TVs, air conditioners, and refrigerators
- Provide **zero unique content** for the keyword their slug targets
- Create SEO cannibalisation against the real Ecwid category pages

## Rebranding opportunity

These are the site's **only content-marketing surface** and they're wasted. Two options:

1. **Convert to real buying guides** (recommended) — "How to choose a refrigerator", "No Frost vs. Defrost explained", "What size oven do you need?" With genuine Arabic editorial content, internal links to the matching Ecwid category, and a comparison table. This gives SADKO organic search entry points it currently has none of.
2. **Delete and 301-redirect** to the corresponding Ecwid category route, consolidating SEO signal.

Either way the current state — four identical catalog dumps at Arabic vanity URLs — should not survive the rebrand.
