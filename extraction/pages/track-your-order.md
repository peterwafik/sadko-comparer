---
route: /track-your-order/
title: تابع طلبك / Track Your Order
type: wordpress-page
editable: true
builder: Divi
status: PLACEHOLDER
rebrandPriority: 7
---

# Track Your Order — https://www.sadko-group.com/track-your-order/

## Current state: **"Coming Soon"**

This page is linked from the **primary navigation on every page of the site** but contains no functionality.

## Content
- Global header and footer (standard)
- Main heading: **"Coming Soon"**
- A redirect link to the external courier: `https://movex.com.eg/track-shipment/`

## Functionality
- **No form.** No order-number field, no email field, no submit button.
- **No integration.** Tracking is entirely outsourced to Movex, a third-party shipping company, on a different domain.

## Rebranding notes
- **High-severity issue.** A dead-end placeholder sits in the top-level nav — one of only three nav items. It signals an unfinished site to every visitor.
- Users are handed off to an unbranded third-party domain (`movex.com.eg`) with no context, no SADKO branding, and no return path.
- Two viable rebrand paths:
  1. **Build it** — order-number + phone lookup form, Ecwid order status API, branded status timeline.
  2. **Remove it** — drop from nav, fold tracking into the account area, and link Movex from order confirmation emails instead.
- Note the redundancy: "Track Orders" also appears in the Ecwid header controls, so the site has **two competing order-tracking entry points**, neither of which works natively.
