# Brand logos

The "shop by brand" row on `shop.html` renders a circular tile per brand. A tile
asks for a logo only if its key appears in `logos.json`, which maps the brand key
to the file name beside it:

    "toshiba": "toshiba.png"   ->  site/assets/img/brands/toshiba.png
    "kiriazi": "kiriazi.svg"   ->  site/assets/img/brands/kiriazi.svg

The manifest carries the file name rather than just the key because the logos do
not all arrive in one format. If a file is missing or fails to decode, the `<img>`
removes itself and the tile falls back to a wordmark disc — the brand name in SADKO
teal on a tinted circle. That fallback is deliberate, so the row looks finished
whether or not every logo is in place.

The key is the lowercased brand name that `skSpecs` derives, which is also what
appears in the URL when you filter by that brand (`shop.html?brand=kiriazi`). To
see the current keys, open `shop.html`, expand **Advanced search**, and read the
Brand dropdown — the keys are the option values.

## What is committed here, and where it came from

Fetched 2026-09-06. Eleven come from Wikimedia Commons — SVG sources rendered to
PNG so the transparency survives, then scaled to 192px on the long edge (2× the
84px tile) with ffmpeg — and Kiriazi comes from Kiriazi's own site, which publishes
its logo as an SVG.

Note on Zanussi: Wikidata's logo property for Zanussi returns the **Electrolux**
mark (Zanussi is an Electrolux brand), and the obvious Commons file
`Zanussi-Logo.svg` is the yellow-square lockup, which fills a white circle with a
yellow block and reads as a broken tile. `Logo Zanussi.png` is the wordmark alone,
which is what the row wants.

| key | file | source | licence |
|---|---|---|---|
| kiriazi | kiriazi.svg | https://kiriazi.com/assets/softextwo/images/logo.svg | brand's own site |
| fresh | fresh.png | commons `File:Fresh Electric.svg` | Public domain |
| tornado | tornado.png | commons `File:تورنيدو-لوجو.png` | **CC BY-SA 4.0** |
| toshiba | toshiba.png | commons `File:Toshiba logo.svg` | Public domain |
| midea | midea.png | commons `File:Midea.svg` | Public domain |
| sharp | sharp.png | commons `File:Logo of the Sharp Corporation.svg` | Public domain |
| haier | haier.png | commons `File:Haier logo.svg` | Public domain |
| zanussi | zanussi.png | commons `File:Logo Zanussi.png` | Public domain |
| beko | beko.png | commons `File:New Beko logo.svg` | Public domain |
| carrier | carrier.png | commons `File:Logo of the Carrier Corporation.svg` | Public domain |
| panasonic | panasonic.png | commons `File:Panasonic Group logo.svg` | Public domain |
| samsung | samsung.png | commons `File:Samsung wordmark.svg` | Public domain |

Two things to know before this ships:

1. **Tornado is CC BY-SA 4.0**, not public domain like the rest. That licence wants
   attribution and share-alike on the image. Everything else here is a plain logo
   below the threshold of originality, which is why Commons marks it public domain.
   If the share-alike terms are awkward, replace `tornado.png` with the file El Araby
   supplies to its dealers and delete this note.
2. These are third-party trademarks. A retailer normally has the right to show the
   marks of the brands it sells, and that is what this row does. Where SADKO already
   has dealer-supplied artwork, prefer it over these — drop the file in and update
   `logos.json`; no code change is needed.

## Format

Square-ish, transparent background, at least 168×168 (or any SVG) so it stays sharp
on the 84px tile at 2× pixel density. The tile applies `object-fit: contain` with
padding, so logos of different proportions still line up. Wide wordmarks (Toshiba,
Panasonic, Samsung, Sharp) are the awkward case — they end up short inside a circle,
which is why `.btile__logo` uses tight padding.
