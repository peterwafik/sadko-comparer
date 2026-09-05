# Brand logos

The "shop by brand" row on `shop.html` renders a circular tile per brand. Each tile
asks for a logo at:

    site/assets/img/brands/<brand-key>.png

If the file is missing the `<img>` removes itself and the tile falls back to a
wordmark disc — the brand name set in SADKO teal on a tinted circle. That fallback
is deliberate, so the row looks finished whether or not the logos are in place.

**No logo files are committed here.** Brand logos are third-party trademarks
(Kiriazi, Fresh, Tornado, Toshiba, Sharp, Midea, Beko, LG, Samsung, …). A retailer
normally has the right to display the marks of the brands it sells, but the files
have to come from SADKO — from the brands' own press/partner kits or from whatever
SADKO already uses in its showrooms — not scraped off another retailer's CDN.

## Adding them

Drop a file in named after the brand key and it lights up with no code change. The
key is the lowercased brand name that `skSpecs` derives, which is also what appears
in the URL when you filter by that brand:

    shop.html?brand=kiriazi   ->  assets/img/brands/kiriazi.png

To see the current keys and how many products each covers, open `shop.html`, expand
**Advanced search**, and read the Brand dropdown — the keys are the option values.

Format: square-ish PNG (or SVG, renaming the reference in `shop.js`'s `advData`
sibling — see `renderHub`'s `logo:` line), transparent background, at least
168×168 so it stays sharp on the 84px tile at 2× pixel density. The tile applies
`object-fit: contain` with padding, so logos of different proportions still line up.
