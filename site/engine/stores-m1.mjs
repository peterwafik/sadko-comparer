/* Milestone-1 stores: SADKO's own catalog plus the 12 highest-value sitemap
   stores measured by scripts/probe-sitemaps.mjs (94,482 product URLs total).
   rayashop / amanstores / egyptlaptop / awadserag are included DELIBERATELY —
   their live search is broken, so indexing rescuing them is the proof the
   architecture works. */
/* The URL counts below come from scripts/probe-sitemaps.mjs, which counted ALL
   <loc> entries. Spot-checking the real sitemaps showed some of those are
   navigation, not products — rayashop's sitemap.xml is a CATEGORY sitemap
   (/en/electronics, /en/laptops/laptops-pcs), so its 22,076 is not 22,076
   products. Treat these as an upper bound on reachable URLs, not a product
   count. Task 10 measures the real yield per store.

   sitemapHint  — substring selecting the right child of a sitemap index
   productUrl   — RegExp replacing the generic isProductUrl heuristic         */
export const M1_STORES = [
  { domain: 'sadko-group.com', name: 'صادكو جروب', nameEn: 'SADKO Group', tier: 1, local: true },
  { domain: 'hyper-techno.com',name: 'هايبر تكنو', nameEn: 'Hyper Techno',tier: 3 },  // 17,333 · /product/ ✓
  { domain: 'jumia.com.eg',    name: 'جوميا',      nameEn: 'Jumia',       tier: 1 },  // 10,000
  { domain: '2b.com.eg',       name: '2B مصر',     nameEn: '2B Egypt',    tier: 1 },  //  7,611
  { domain: 'btech.com',       name: 'بى تك',      nameEn: 'B.TECH',      tier: 1 },  //  7,205 · /ar/p/ ✓
  // bare-slug product URLs — no marker; relies on the fallback path
  { domain: 'elarabygroup.com',name: 'العربى جروب',nameEn: 'ElAraby',     tier: 1 },  //  6,369
  // sitemap index exposes products1.xml; URLs are category-path style
  { domain: 'egyptlaptop.com', name: 'إيجيبت لابتوب', nameEn: 'Egypt Laptop', tier: 2,
    sitemapHint: 'products' },                                                        //  6,193
  { domain: 'elghazawy.com',   name: 'الغزاوى',    nameEn: 'ElGhazawy',   tier: 2 },  //  6,179 · /ar/product/ ✓
  { domain: 'amanstores.com',  name: 'أمان',       nameEn: 'Aman Stores', tier: 1 },  //  4,885 · /product/view/ ✓
  { domain: 'awadserag.com',   name: 'عوض سراج',   nameEn: 'Awad Serag',  tier: 3 },  //  2,675
  { domain: 'kenzz.com',       name: 'كنز',        nameEn: 'Kenzz',       tier: 2 },  //  2,064
  { domain: 'egypt.sharafdg.com', name: 'شرف دى جى', nameEn: 'Sharaf DG', tier: 1 },  //  1,892 · /product/ ✓
  // sitemap.xml here lists CATEGORIES, not products. Kept in the set so Task 10
  // measures it honestly; if it yields no products, it needs category-pagination
  // crawling, which is Milestone 2.
  { domain: 'rayashop.com',    name: 'راية شوب',   nameEn: 'Raya Shop',   tier: 1 },
];
