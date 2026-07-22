/* ============================================================================
   SADKO customer-information pages — warranty, delivery, privacy, terms.
   ----------------------------------------------------------------------------
   ONE renderer, four pages. Each page calls:

       mountInfo(document.getElementById('info-root'), 'warranty')

   and everything else — the honesty banner, the "last updated" line, the
   in-page contents, the sections and the cross-links — comes out of the PAGES
   data structure below. Content is separated from layout exactly the way
   data/guides.json separates articles from guides.js: to add or reword a
   clause you edit a data block, never the renderer.

   THE HONESTY RULE THIS FILE IS BUILT AROUND
   This site is a rebrand preview built on scraped catalogue data. There is no
   signed-off legal text behind it. So:
     • everything written here is guidance that is TRUE of how this site and
       this kind of purchase actually work;
     • anything that would need SADKO's own sign-off (refund windows, fee
       tables, retention periods, statutory wording) is rendered as a visible
       `todo()` flag instead of being invented;
     • where a number is genuinely unknown the text says "اسأل خدمة العملاء"
       rather than guessing;
     • the binding terms are the invoice, the warranty card and the seller's
       own policy — the banner on every page says so.

   Block vocabulary (see the helpers under "content grammar"):
     p, h, ul, ol, note, todo, links, table, defs
   ========================================================================== */
(function () {
  'use strict';

  const A = () => window.skApp;
  const t = (ar, en) => (A() ? A().t(ar, en) : ar);
  const E = s => (A() ? A().esc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const P = p => (A() ? A().P(p) : p);

  const TEL = '19140';
  const MAIL = 'csupport@sadko-group.com';
  const UPDATED = '2026-07-22';

  /* ================= shared document typography =================
     app.css owns the chrome (.panel/.note/.tbl/.chips). These are only the
     few rules a legal/《document》page needs on top of it, injected once so all
     four pages share one source. */
  const CSS = [
    '.doc{font-size:.93rem;line-height:1.85;max-width:74ch}',
    '.doc>p{margin:0 0 12px}.doc>p:last-child{margin-bottom:0}',
    '.doc h3{font-size:1rem;font-weight:900;margin:22px 0 8px}',
    '.doc h3:first-child{margin-top:4px}',
    '.doc ul,.doc ol{margin:0 0 14px;padding-inline-start:1.3em}',
    '.doc li{margin-bottom:8px}',
    '.doc ol{counter-reset:none}',
    '.doc a{overflow-wrap:anywhere}',
    '.doc .note,.doc .chips{margin:0 0 14px}',
    '.doc-scroll{overflow-x:auto;margin:0 0 16px;border-radius:12px}',
    '.doc-scroll .tbl{min-width:540px}',
    '.doc-scroll .tbl th[scope=row]{font-weight:800;font-size:.86rem;color:var(--ink);text-transform:none;letter-spacing:0}',
    '.doc-defs{margin:0 0 16px}',
    '.doc-defs li{display:block}',
    '.doc-defs .k{display:block;margin-bottom:3px;font-size:.86rem}',
    '.doc-defs .v{display:block;text-align:start;font-weight:600;line-height:1.8;font-size:.88rem}',
    '.doc-flag{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}',
    '.doc-flag .badge{flex:0 0 auto}',
    '.info-top{margin-bottom:18px}',
    '.info-updated{margin:12px 0 0;font-size:.8rem;font-weight:700;color:var(--ink-soft)}',
    '.info-toc{margin:14px 0 0}',
    '.info-x .chips{margin-top:4px}',
    '@media (max-width:640px){.doc{font-size:.9rem}.doc-scroll .tbl{min-width:460px}}',
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('info-css')) return;
    const s = document.createElement('style');
    s.id = 'info-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ================= content grammar ================= */
  const p = (ar, en) => ({ t: 'p', ar, en });
  const h = (ar, en) => ({ t: 'h', ar, en });
  const ul = items => ({ t: 'ul', items });          // [[ar,en], …]
  const ol = items => ({ t: 'ol', items });          // [[ar,en], …]
  const note = (k, ar, en) => ({ t: 'note', k, ar, en });   // k: info|warn|soft
  const todo = (ar, en) => ({ t: 'todo', ar, en });  // needs SADKO sign-off
  const links = items => ({ t: 'links', items });    // [[ar,en,href], …]
  const table = (head, rows) => ({ t: 'table', head, rows });
  const defs = rows => ({ t: 'defs', rows });        // [[k_ar,k_en,v_ar,v_en], …]

  const pick = pair => t(pair[0], pair[1]);

  /* ================= block renderer ================= */
  function block(b) {
    switch (b.t) {
      case 'p':
        return '<p>' + E(t(b.ar, b.en)) + '</p>';
      case 'h':
        return '<h3>' + E(t(b.ar, b.en)) + '</h3>';
      case 'ul':
        return '<ul>' + b.items.map(i => '<li>' + E(pick(i)) + '</li>').join('') + '</ul>';
      case 'ol':
        return '<ol>' + b.items.map(i => '<li>' + E(pick(i)) + '</li>').join('') + '</ol>';
      case 'note':
        return '<p class="note note--' + (b.k || 'info') + '">' + E(t(b.ar, b.en)) + '</p>';
      case 'todo':
        return '<div class="note note--warn doc-flag">' +
          '<span class="badge badge--amber">' + E(t('محتاج اعتماد صادكو', 'Needs SADKO sign-off')) + '</span>' +
          '<span>' + E(t(b.ar, b.en)) + '</span></div>';
      case 'links':
        return '<p class="chips">' + b.items.map(i =>
          '<a class="chip" href="' + E(hrefOf(i[2])) + '">' + E(pick(i)) + '</a>').join('') + '</p>';
      case 'table':
        return '<div class="doc-scroll"><table class="tbl"><thead><tr>' +
          b.head.map(c => '<th scope="col">' + E(pick(c)) + '</th>').join('') +
          '</tr></thead><tbody>' +
          b.rows.map(r => '<tr>' + r.map((c, i) => i === 0
            ? '<th scope="row">' + E(pick(c)) + '</th>'
            : '<td>' + E(pick(c)) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>';
      case 'defs':
        return '<ul class="specs doc-defs">' + b.rows.map(r =>
          '<li><span class="k">' + E(t(r[0], r[1])) + '</span>' +
          '<span class="v">' + E(t(r[2], r[3])) + '</span></li>').join('') + '</ul>';
      default:
        return '';
    }
  }

  // tel:/mailto:/external links stay as they are; internal ones go through P().
  function hrefOf(href) {
    return /^(tel:|mailto:|https?:|#)/.test(href) ? href : P(href);
  }

  /* ================= the four pages ================= */

  /* The banner every page carries. Same words everywhere on purpose: this is
     the single honest disclosure, not a per-page variation. */
  const BANNER = note('warn',
    'الصفحة دى إرشادات مكتوبة للنسخة التجريبية من موقع صادكو (Rebrand Preview)، مش نص قانونى معتمد. الشروط الملزمة هى اللى مكتوبة فى الفاتورة وكارت الضمان وسياسة البائع اللى اشتريت منه. أى مدة أو رسم أو رقم مش لاقيه هنا — اسأل خدمة العملاء على ' + TEL + ' بدل ما تفترض.',
    'This page is guidance written for the SADKO rebrand preview site — it is not approved legal text. The binding terms are the ones printed on your invoice, on the warranty card, and in the policy of the seller you bought from. If a period, a fee or a figure is not stated here, ask customer care on ' + TEL + ' rather than assume.');

  const XLINKS = {
    warranty: ['الضمان والاسترجاع', 'Warranty & returns', 'warranty.html'],
    delivery: ['التوصيل والتركيب', 'Delivery & installation', 'delivery.html'],
    privacy: ['الخصوصية', 'Privacy', 'privacy.html'],
    terms: ['شروط الاستخدام', 'Terms of use', 'terms.html'],
  };

  const PAGES = {

    /* ------------------------------------------------------------------ */
    warranty: {
      sections: [
        {
          id: 'seller',
          h: ['مين البائع؟ ده أهم سؤال فى الضمان', 'Who is the seller? That is the warranty question that matters'],
          sub: ['الموقع ده بيعرض حاجتين مختلفتين: منتجات بتتباع من صادكو، ونتايج مقارنة أسعار من متاجر تانية. الضمان والخدمة مش واحد فى الحالتين.',
            'This site shows two different things: products sold by SADKO, and price-comparison results from other stores. Warranty and service are not the same in the two cases.'],
          blocks: [
            table(
              [['البند', 'Item'], ['اشتريت من صادكو', 'Bought from SADKO'], ['لقيته فى مقارنة الأسعار (متجر تانى)', 'Found via price comparison (another store)']],
              [
                [['مين مسؤول عن الضمان', 'Who carries the warranty'],
                 ['ضمان المصنّع + خدمة ما بعد البيع من صادكو', 'The manufacturer’s warranty plus SADKO after-sales service'],
                 ['ضمان المصنّع + المتجر البائع. صادكو مش طرف فى العملية دى', 'The manufacturer’s warranty plus that store. SADKO is not a party to it']],
                [['مين بيستقبل طلب الصيانة', 'Who takes the service request'],
                 ['خدمة عملاء صادكو على ' + TEL, 'SADKO customer care on ' + TEL],
                 ['خدمة عملاء المتجر اللى اشتريت منه', 'The customer care of the store you bought from']],
                [['الاسترجاع والاستبدال', 'Returns and exchange'],
                 ['سياسة صادكو، وبالفاتورة الصادرة منها', 'SADKO’s policy, against the invoice it issued'],
                 ['سياسة المتجر ده هو — ممكن تكون مختلفة تماماً', 'That store’s policy — it can be completely different']],
                [['التوصيل والتركيب', 'Delivery and installation'],
                 ['حسب وصف المنتج، وبتأكيد من خدمة عملاء صادكو', 'Per the product description, confirmed by SADKO customer care'],
                 ['شروط المتجر ده، ومواعيده ورسومه', 'That store’s terms, timing and fees']],
                [['الفاتورة', 'The invoice'],
                 ['فاتورة صادكو هى إثبات الشراء', 'A SADKO invoice is your proof of purchase'],
                 ['فاتورة المتجر ده هى إثباتك الوحيد — احتفظ بيها', 'That store’s invoice is your only proof — keep it']],
              ]),
            note('warn',
              'صادكو بتعرض أسعار متاجر تانية عشان تشوف السوق قدامك بوضوح، بس هى مش وسيط فى البيع ده ولا طرف فى العقد. لو اشتريت من متجر تانى، اسأله هو — قبل ما تدفع — عن الضمان والتركيب والاسترجاع، ومتفترضش إن شروطه زى شروط صادكو.',
              'SADKO shows other stores’ prices so you can see the market clearly, but it is not a broker in that sale and not a party to that contract. If you buy from another store, ask that store — before you pay — about warranty, installation and returns, and do not assume its terms match SADKO’s.'),
            note('info',
              'صفحة «أجهزتى» بتفرّق بين الاتنين: لما تسجّل جهاز، بتقولها اشتريته من صادكو ولا من متجر تانى، وبتفضل مكتوبة معاك مع تاريخ الشراء وباقى مدة الضمان.',
              'The "My appliances" page keeps the distinction: when you record an appliance you say whether it came from SADKO or another store, and that stays recorded alongside the purchase date and the remaining warranty.'),
            links([
              ['أجهزتى والضمان', 'My appliances & warranty', 'appliances.html'],
              ['مقارنة الأسعار', 'Price comparison', 'compare.html'],
            ]),
          ],
        },
        {
          id: 'covers',
          h: ['ضمان المصنّع بيغطى إيه عادةً — وإيه اللى بره الضمان', 'What a manufacturer warranty usually covers — and what it does not'],
          sub: ['الكلام ده وصف عام لطريقة شغل ضمانات الأجهزة المنزلية فى مصر، مش نص ضمان موديل معيّن. النص الملزم هو اللى فى كارت الضمان اللى جاى مع جهازك.',
            'This is a general description of how home-appliance warranties usually work in Egypt, not the text of any specific model’s warranty. The binding text is the warranty card that came with your appliance.'],
          blocks: [
            h('اللى بيتغطى عادةً', 'Usually covered'),
            ul([
              ['عيوب التصنيع والمواد اللى بتظهر فى الاستخدام المنزلى الطبيعى.', 'Manufacturing and material defects that show up in normal domestic use.'],
              ['القطع اللى بتعطل من نفسها من غير سبب خارجى.', 'Parts that fail on their own with no external cause.'],
              ['مصنعية الإصلاح — بس دى مش دايماً داخلة. اسأل صراحة: الضمان ده قطع بس، ولا قطع ومصنعية؟', 'The labour of the repair — but not always. Ask explicitly: is this parts only, or parts and labour?'],
              ['قطع رئيسية بمدة أطول أحياناً، زى الكمبروسر فى الثلاجات والموتور فى الغسالات.', 'Sometimes a longer period on a major part, such as a refrigerator compressor or a washer motor.'],
            ]),
            h('اللى بيتستثنى عادةً', 'Usually excluded'),
            ul([
              ['الاستهلاك الطبيعى: الفلاتر، اللمبات، الجوانات، الفرش والملحقات.', 'Normal wear: filters, lamps, seals, brushes and accessories.'],
              ['الكسر، ودخول المياه، والحريق، وأى ضرر مادى بعد الاستلام.', 'Breakage, water ingress, fire and any physical damage after delivery.'],
              ['الحشرات والقوارض جوه الجهاز.', 'Insects and rodents inside the appliance.'],
              ['الاستخدام التجارى لجهاز مصنوع للاستخدام المنزلى (مطعم، محل، مغسلة).', 'Commercial use of an appliance built for the home (a restaurant, a shop, a laundry).'],
              ['الضرر الناتج عن كهربا غير مناسبة أو تركيب غلط أو تشغيل مخالف للكتيّب.', 'Damage caused by unsuitable power, wrong installation, or operation contrary to the manual.'],
              ['الشكل الخارجى والخدوش اللى ما اتسجّلتش وقت الاستلام.', 'Cosmetic marks and scratches not recorded at the time of delivery.'],
            ]),
            note('info',
              '«ضمان ٥ سنين» أو «١٠ سنين» فى الإعلان غالباً بتكون على قطعة واحدة — الكمبروسر أو الموتور — مش على الجهاز كله. اقرا الكارت وشوف كل مدة على إيه بالظبط.',
              'A "5-year" or "10-year" warranty in an advert is usually on a single part — the compressor or the motor — not on the whole appliance. Read the card and see exactly what each period covers.'),
            todo('مدد الضمان الفعلية لكل ماركة وموديل مش منشورة على الموقع ده، لأن الكتالوج مقروء آلياً من أوصاف المنتجات ومش كل وصف بيذكرها. المدة الصح هى اللى فى كارت الضمان أو اللى بتأكدها خدمة العملاء.',
              'Actual warranty periods per brand and model are not published on this site: the catalogue is read automatically from product descriptions and not every description states them. The correct period is the one on the warranty card, or the one customer care confirms.'),
            links([['دليل: تقارن الضمانات صح', 'Guide: comparing warranties properly', 'guides.html?g=warranty-explained']]),
          ],
        },
        {
          id: 'papers',
          h: ['الفاتورة وكارت الضمان — ليه الورقتين دول بالذات', 'The invoice and the warranty card — why these two pieces of paper'],
          blocks: [
            p('الضمان بيبدأ من تاريخ الشراء، والفاتورة هى الحاجة الوحيدة اللى بتثبت التاريخ ده. من غيرها الضمان بيتحوّل لنقاش. كارت الضمان بيحدّد المدة والتغطية ومركز الخدمة المسؤول.',
              'A warranty runs from the date of purchase, and the invoice is the only thing that proves that date. Without it the warranty becomes an argument. The warranty card sets the period, the coverage and the service centre responsible.'),
            ul([
              ['صوّر الفاتورة وكارت الضمان بالموبايل من أول يوم، وابعتهم لنفسك على الإيميل.', 'Photograph the invoice and the warranty card on day one and e-mail them to yourself.'],
              ['صوّر لوحة البيانات على ظهر الجهاز (الموديل + الرقم التسلسلى) — هتحتاجها فى كل مكالمة صيانة.', 'Photograph the rating plate on the back of the appliance (model + serial number) — you will need it in every service call.'],
              ['لو الضمان محتاج تفعيل أو تسجيل خلال مدة معينة، اعمله فى نفس الأسبوع.', 'If the warranty needs activation or registration within a period, do it the same week.'],
              ['احتفظ بإيصال التركيب كمان — بيثبت إن التركيب اتعمل بالطريقة المعتمدة.', 'Keep the installation receipt too — it proves the installation was done the approved way.'],
            ]),
            note('soft',
              'صفحة «أجهزتى» على الموقع ده بتحفظ الموديل والرقم التسلسلى وتاريخ الشراء ومدة الضمان، وبتحسب لك باقى كام يوم. البيانات دى متخزنة فى متصفحك انت (مش على سيرفر)، يعنى نسخة الصور والفاتورة الأصلية لازم تفضل معاك برضه.',
              'The "My appliances" page stores the model, serial number, purchase date and warranty length, and counts the days left for you. That data lives in your own browser (not on a server), so you still need to keep your own copies of the invoice and photos.'),
            links([['سجّل جهازك فى «أجهزتى»', 'Record your appliance in "My appliances"', 'appliances.html']]),
          ],
        },
        {
          id: 'kinds',
          h: ['ضمان المصنّع، وضمان البائع، والتزامات البائع القانونية', 'Manufacturer warranty, seller warranty, and the seller’s legal obligations'],
          blocks: [
            defs([
              ['ضمان المصنّع', 'Manufacturer warranty',
               'بتقدمه الشركة المصنّعة أو وكيلها فى مصر، وبينفّذ عن طريق مراكز الخدمة المعتمدة بتاعتها. المدة والتغطية مكتوبة فى كارت الضمان.',
               'Provided by the manufacturer or its agent in Egypt and carried out through its authorised service centres. The period and coverage are on the warranty card.'],
              ['ضمان البائع / المتجر', 'Seller / store warranty',
               'أى تغطية زيادة بيقدمها المتجر نفسه (استبدال فى أول فترة، تركيب مجانى، صيانة دورية). بتختلف من متجر لمتجر، ولازم تكون مكتوبة.',
               'Any extra cover the store itself offers (an early exchange, free installation, routine servicing). It differs between stores and should be in writing.'],
              ['ضمان ممتد بفلوس', 'Paid extended warranty',
               'منتج منفصل بتشتريه. اسأل: بيبدأ بعد ضمان المصنّع ولا معاه؟ وبيغطى إيه بالظبط؟ ومين اللى هينفّذه؟',
               'A separate product you buy. Ask: does it start after the manufacturer’s warranty or run alongside it? What exactly does it cover? Who performs it?'],
              ['التزامات البائع القانونية', 'The seller’s legal obligations',
               'حقوق المشترى قِبَل البائع فى القانون المصرى موجودة ومستقلة عن كارت الضمان — مش هنكتب لك أرقام مواد ولا مدد من غير مراجعة قانونية. لو محتاج تفاصيلها، اسأل خدمة العملاء أو جهة حماية المستهلك.',
               'A buyer’s rights against the seller under Egyptian law exist and are separate from the warranty card — we will not quote article numbers or periods here without legal review. For the detail, ask customer care or the consumer-protection authority.'],
            ]),
            todo('نص الالتزامات القانونية والصياغة الرسمية للضمان محتاجين مراجعة قانونية واعتماد من صادكو قبل ما ينزلوا كنص ملزم.',
              'The statutory-obligations text and the formal warranty wording need legal review and SADKO sign-off before they can be published as binding text.'),
          ],
        },
        {
          id: 'void',
          h: ['إيه اللى بيسقط الضمان', 'What typically voids a warranty'],
          blocks: [
            ul([
              ['تصليح عند فنى غير معتمد، أو استخدام قطع غيار مش أصلية — ده أشهر سبب على الإطلاق.', 'A repair by an unauthorised technician, or non-original spare parts — by far the most common reason.'],
              ['تركيب بواسطة حد غير معتمد، خصوصاً فى التكييف والسخانات والبوتاجاز الغاز.', 'Installation by someone unauthorised, especially for air conditioners, water heaters and gas cookers.'],
              ['توصيل الجهاز على جهد غير مناسب، أو إهمال شرط مكتوب فى الكتيّب زى استخدام منظّم جهد (استابلايزر).', 'Connecting the appliance to unsuitable voltage, or ignoring a condition stated in the manual such as using a voltage stabiliser.'],
              ['ضرر حصل فى النقل بعد الاستلام — أو تشغيل جهاز تبريد فوراً بعد ما اتنقل مايل.', 'Damage that happened in transport after you took delivery — or switching on a cooling appliance immediately after it was moved tilted.'],
              ['نزع أو مسح ملصق الرقم التسلسلى (السيريال)، أو فتح الجهاز بنفسك.', 'Removing or defacing the serial-number label, or opening the appliance yourself.'],
              ['الاستخدام التجارى لجهاز منزلى.', 'Commercial use of a domestic appliance.'],
            ]),
            note('warn',
              'مسامير النقل فى ضهر الغسالة لازم تتفك قبل أول غسلة. لو الغسالة اشتغلت وهى مركّبة ممكن تتلف، والتلف ده غالباً بيبقى بره الضمان.',
              'The transit bolts at the back of a washing machine must be removed before the first wash. Running it with them still fitted can damage it, and that damage is usually outside the warranty.'),
          ],
        },
        {
          id: 'claim',
          h: ['إزاى تبدأ طلب ضمان أو صيانة', 'How to start a warranty or service claim'],
          blocks: [
            ol([
              ['جهّز الورق: الفاتورة، كارت الضمان، الموديل والرقم التسلسلى، وتاريخ الشراء.', 'Get the paperwork ready: invoice, warranty card, model and serial number, and the purchase date.'],
              ['صوّر أو سجّل فيديو للعطل نفسه — ده بيوفّر زيارة كشف كاملة أحياناً.', 'Photograph or video the fault itself — sometimes it saves an entire diagnostic visit.'],
              ['حدّد البائع: صادكو ولا متجر تانى؟ لو متجر تانى، اتصل بيه هو مش بينا.', 'Identify the seller: SADKO or another store? If it is another store, contact them, not us.'],
              ['لو صادكو: اتصل على ' + TEL + '، أو ابعت إيميل على ' + MAIL + ' وارفق صور الفاتورة والعطل.', 'If it is SADKO: call ' + TEL + ', or e-mail ' + MAIL + ' attaching photos of the invoice and the fault.'],
              ['صفحة «مركز خدمة العملاء» بتجهّز لك نص الطلب كامل بالبيانات المطلوبة عشان تبعته انت بنفسك.', 'The customer care page prepares the full request text with the needed details, for you to send yourself.'],
              ['اطلب رقم مرجعى للطلب واحتفظ بيه، واحتفظ بنسخة من الرسالة اللى بعتها.', 'Ask for a reference number and keep it, and keep a copy of the message you sent.'],
            ]),
            note('info',
              'الموقع ده مش بيفتح تذكرة صيانة أوتوماتيك ولا بيتابعها، وما فيش نظام تتبع أونلاين. اللى بيعمله إنه بيجهّزلك الطلب مكتوب صح — الإرسال والمتابعة بيتمّوا على التليفون أو الإيميل.',
              'This site does not open or track a service ticket automatically, and there is no online tracking system. What it does is prepare a properly written request — sending and following up happen by phone or e-mail.'),
            links([
              ['مركز خدمة العملاء', 'Customer care', 'care.html'],
              ['أجهزتى والضمان', 'My appliances & warranty', 'appliances.html'],
              ['اتصل ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
              ['ابعت إيميل', 'Send an e-mail', 'mailto:' + MAIL],
            ]),
          ],
        },
        {
          id: 'returns',
          h: ['الاسترجاع والاستبدال', 'Returns and exchange'],
          blocks: [
            p('الاسترجاع والاستبدال بيتمّوا مع البائع المكتوب فى الفاتورة، مش مع الموقع. والعملية بتبقى أسهل بكتير لما الكرتونة والملحقات والفاتورة كلها معاك وبحالتها.',
              'Returns and exchanges are handled by the seller named on the invoice, not by the website. The process is far easier when the box, the accessories and the invoice are all with you and intact.'),
            ul([
              ['افحص الجهاز قدام فريق التوصيل قبل ما تمضى، وسجّل أى خدش أو كسر فى إيصال الاستلام نفسه.', 'Inspect the appliance in front of the delivery team before you sign, and record any scratch or damage on the delivery note itself.'],
              ['الجهاز اللى اتركّب أو اتشغّل بيبقى ليه شروط مختلفة عن جهاز لسه فى كرتونته.', 'An appliance that has been installed or used is treated differently from one still in its box.'],
              ['لو المنتج من متجر تانى عن طريق مقارنة الأسعار، سياسة الاسترجاع بتاعته هى اللى بتسرى.', 'If the product came from another store through price comparison, that store’s return policy applies.'],
            ]),
            todo('مدة الاسترجاع وشروطه المعتمدة من صادكو مش منشورة هنا، وما ينفعش نخترعها. لحد ما تتعتمد وتتكتب، اسأل خدمة العملاء على ' + TEL + ' قبل ما تشترى لو الاسترجاع مهم لك.',
              'SADKO’s approved return window and conditions are not published here, and we are not going to invent them. Until they are approved and written, ask customer care on ' + TEL + ' before buying if returns matter to you.'),
          ],
        },
      ],
    },

    /* ------------------------------------------------------------------ */
    delivery: {
      sections: [
        {
          id: 'areas',
          h: ['مناطق التوصيل', 'Where we deliver'],
          sub: ['المعلومات دى مقروءة من أوصاف المنتجات فى الكتالوج نفسه — يعنى بتوصف الغالب، مش وعد على كل منتج.',
            'This is read from the product descriptions in the catalogue itself — it describes what is typical, not a promise on every product.'],
          blocks: [
            ul([
              ['القاهرة الكبرى والجيزة — التغطية الأساسية، وأغلب أوصاف المنتجات بتذكر توصيل بدون رسوم فيها.', 'Greater Cairo and Giza — the core coverage, and most product descriptions mention delivery at no charge there.'],
              ['الإسكندرية — مذكورة مع القاهرة والجيزة فى أوصاف التوصيل والتركيب.', 'Alexandria — named alongside Cairo and Giza in the delivery and installation notes.'],
              ['الساحل الشمالى — موسمى وعليه رسوم إضافية حسب وصف المنتج، ومعرض مارينا نفسه بيشتغل فى الصيف بس.', 'The North Coast — seasonal and with an extra fee per the product description; the Marina showroom itself opens only in summer.'],
              ['باقى المحافظات — مش مذكورة فى بيانات المنتجات، فاسأل خدمة العملاء على ' + TEL + ' قبل ما تطلب.', 'Other governorates — not stated in the product data, so ask customer care on ' + TEL + ' before ordering.'],
            ]),
            note('warn',
              'التوصيل والتركيب بيتغيّروا من منتج لمنتج ومن محافظة لمحافظة. صفحة المنتج نفسها هى أدق مصدر، وأى تأكيد نهائى بيتم مع خدمة العملاء أو المعرض.',
              'Delivery and installation differ by product and by governorate. The product page itself is the most accurate source, and final confirmation comes from customer care or the showroom.'),
            links([
              ['المعارض والفروع', 'Showrooms', 'showrooms.html'],
              ['اتصل ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
            ]),
          ],
        },
        {
          id: 'fees',
          h: ['الرسوم — اللى نعرفه واللى لازم تتأكد منه', 'Fees — what we know, and what you must confirm'],
          blocks: [
            defs([
              ['التوصيل المجانى', 'Free delivery',
               'أوصاف كتير فى الكتالوج بتقول «توصيل بدون رسوم» للقاهرة والجيزة والإسكندرية. الجملة دى مأخوذة من وصف المنتج، فاتأكد إنها مكتوبة فى صفحة المنتج اللى انت شاريه بالذات.',
               'Many descriptions in the catalogue say delivery is free to Cairo, Giza and Alexandria. That sentence comes from the product description, so check it is present on the page of the exact product you are buying.'],
              ['رسوم الساحل الشمالى', 'North Coast fee',
               'التوصيل للساحل موسمى وعليه رسوم إضافية حسب وصف المنتج. قيمة الرسم نفسها مش مذكورة فى البيانات — اسأل خدمة العملاء.',
               'North Coast delivery is seasonal and carries an extra fee per the product description. The amount itself is not in the data — ask customer care.'],
              ['رسوم التركيب', 'Installation charges',
               'التركيب المتخصص (تكييف، سخان، بوتاجاز غاز) غالباً بيتحاسب منفصل، وأحياناً بيبقى فى ميعاد تانى غير التوصيل. اتفق على السعر قبل ما الفنى يبدأ.',
               'Specialist installation (air conditioner, water heater, gas cooker) is usually charged separately and often happens on a different day from delivery. Agree the price before the technician starts.'],
              ['حالات زيادة', 'Extras',
               'دور عالى من غير أسانسير، أسانسير أصغر من الجهاز، رفع من الشباك، أو مواسير نحاس زيادة عن المتفق عليه فى التكييف — كل دى بتتحسب إضافى عادةً، وبتتفق عليها قبل يوم التوصيل مش فيه.',
               'A high floor with no lift, a lift smaller than the appliance, hoisting through a window, or copper piping beyond the agreed length on an air conditioner — these are normally charged extra, and are agreed before delivery day, not on it.'],
            ]),
            todo('ما فيش جدول رسوم رسمى معتمد من صادكو منشور على النسخة دى — لا لرسوم الساحل ولا للتركيب ولا للشيل. الأرقام بتتأكد مع خدمة العملاء قبل التنفيذ.',
              'There is no official SADKO fee table published in this preview — not for the North Coast, not for installation, not for carrying. Amounts are confirmed with customer care before the work is done.'),
            note('soft',
              'الطلبات اللى بتتحفظ من السلة على الموقع ده بتسيب رسوم التوصيل والتركيب فاضية عن قصد، عشان مانكتبش صفر مش حقيقى على ورقة انت هتحتفظ بيها.',
              'Orders saved from the cart on this site deliberately leave delivery and installation fees blank, so that we do not print an untrue zero on a document you keep.'),
          ],
        },
        {
          id: 'before',
          h: ['قبل ميعاد التوصيل', 'Before the delivery date'],
          sub: ['أكتر مشكلة بتحصل يوم التوصيل مالهاش علاقة بالجهاز: الجهاز مظبوط، بس مش داخل.',
            'The commonest delivery-day problem has nothing to do with the appliance: it is fine, it just does not fit through.'],
          blocks: [
            ol([
              ['قيس مكان الجهاز: العرض فى أضيق نقطة، الارتفاع لحد أقرب حاجة فوق، والعمق شامل الكبّاس والباب مفتوح.', 'Measure the appliance’s space: width at the narrowest point, height to the nearest thing above, and depth including the plug and with the door open.'],
              ['قيس الطريق كله: باب العمارة، السلم أو الأسانسير، باب الشقة، وباب الأوضة. أضيق نقطة هى اللى بتحكم.', 'Measure the whole route: building entrance, stairs or lift, flat door, room door. The narrowest point decides.'],
              ['لو الأسانسير هو الطريق، قيس عرض وعمق وارتفاع الكابينة وعرض بابها — ولو السلم، خد بالك من لفّة البسطة.', 'If the lift is the route, measure the car’s width, depth and height and its door — if it is the stairs, watch the turn at the landing.'],
              ['فضّى الممر ومكان الجهاز، وشيل السجاجيد اللى ممكن تتقطع، وغطّى الأثاث لو فيه شنيور.', 'Clear the corridor and the appliance’s spot, lift rugs that could tear, and cover furniture if drilling is involved.'],
              ['اتأكد إن حد بالغ هيكون موجود فى الميعاد ومعاه رقم فريق التوصيل — والفلوس لو الدفع عند الاستلام.', 'Make sure an adult will be there at the appointment with the delivery team’s number — and the payment if it is cash on delivery.'],
              ['لو العمارة عندها ميعاد أو رسوم لدخول البضاعة، قول للبائع من دلوقتى مش يوم التسليم.', 'If your building has restricted hours or a fee for moving goods in, tell the seller now, not on the day.'],
            ]),
            note('warn',
              'لو الفرق سنتيمتر أو اتنين بس، متعتمدش على «هتعدّى». فك أبواب الجهاز أو الرفع من الشباك حاجات بتتعمل، بس بتتكلف فلوس زيادة ولازم تتفق عليها قبل الميعاد.',
              'If the gap is only a centimetre or two, do not count on "it will fit". Removing the appliance’s doors or hoisting through a window are both possible, but they cost extra and must be agreed in advance.'),
            links([
              ['دليل: إزاى تقيس المكان قبل ما تشترى', 'Guide: measure before you buy', 'guides.html?g=measure-before-you-buy'],
              ['دليل: تجهّز البيت قبل التوصيل والتركيب', 'Guide: prepare for delivery & installation', 'guides.html?g=prepare-for-delivery'],
            ]),
          ],
        },
        {
          id: 'onday',
          h: ['يوم التوصيل — افحص قبل ما تمضى', 'On delivery day — inspect before you sign'],
          blocks: [
            ul([
              ['افحص الكرتونة من بره الأول: أى ضرب أو بلل فى الكرتونة معناه إنك تفتح وتشوف قدامهم.', 'Check the outside of the box first: any dent or damp on the carton means you open and look while they are still there.'],
              ['افتح واتأكد من الموديل واللون والمقاس، ومن الملحقات (خراطيم، أرفف، ريموت، مسامير).', 'Open it and confirm the model, colour and size, and the accessories (hoses, shelves, remote, bolts).'],
              ['سجّل أى خدش أو كسر فى إيصال الاستلام نفسه قبل ما تمضى — الكلام الشفهى مش بيثبت حاجة.', 'Record any scratch or damage on the delivery note itself before signing — a verbal remark proves nothing.'],
              ['خد الفاتورة وكارت الضمان فى إيدك، واتأكد إن تاريخ الشراء مكتوب صح.', 'Take the invoice and the warranty card, and check the purchase date is written correctly.'],
              ['متشغّلش أى جهاز تبريد على طول لو اتنقل واقف أو مايل — سيبه واقف فى مكانه الأول (المتعارف عليه من ساعتين لـ ٤ ساعات، والرقم الصح فى كتيّب الموديل).', 'Do not switch on a cooling appliance straight away if it was moved upright or tilted — let it stand first (commonly two to four hours; the correct figure is in the model’s manual).'],
            ]),
          ],
        },
        {
          id: 'install',
          h: ['مين بيركّب إيه', 'Who installs what'],
          sub: ['التوصيل والتركيب مش نفس الحاجة: فريق التوصيل بيوصّل الجهاز لمكانه، والتركيب المتخصص بيعمله فنى مؤهل وأحياناً فى ميعاد تانى.',
            'Delivery and installation are not the same thing: the delivery team brings the appliance to its place; specialist installation is done by a qualified technician, often on another day.'],
          blocks: [
            table(
              [['الجهاز', 'Appliance'], ['محتاج تركيب؟', 'Needs installation?'], ['مين يعمله', 'Who does it'], ['خد بالك من', 'Watch out for']],
              [
                [['ثلاجة / فريزر', 'Fridge / freezer'], ['لأ', 'No'], ['فريق التوصيل', 'The delivery team'],
                 ['سيبه واقف قبل التشغيل زى ما الكتيّب بيقول، وسيب فتحات تهوية من ورا ومن الجناب.', 'Let it stand before switching on as the manual says, and leave ventilation gaps behind and at the sides.']],
                [['غسالة', 'Washing machine'], ['أيوه — مياه وصرف', 'Yes — water and drain'], ['فنى', 'A technician'],
                 ['فك مسامير النقل قبل أول غسلة، ومحبس مياه شغّال، ونقطة صرف بارتفاع مناسب، وأرضية مستوية.', 'Remove the transit bolts before the first wash; a working water tap, a drain point at the right height, and a level floor.']],
                [['بوتاجاز غاز', 'Gas cooker'], ['أيوه — توصيلة غاز', 'Yes — a gas connection'], ['فنى مؤهل معتمد، وغالباً برسوم', 'A qualified approved technician, usually for a fee'],
                 ['غاز طبيعى ولا أنبوبة (الفوّهات بتختلف)، تهوية فى المطبخ، واختبار تسريب بالصابون قدامك.', 'Natural gas or cylinder (the jets differ), kitchen ventilation, and a soapy leak test done in front of you.']],
                [['تكييف سبليت', 'Split air conditioner'], ['أيوه — تركيب متخصص', 'Yes — specialist installation'], ['فنى معتمد، وغالباً برسوم', 'An approved technician, usually for a fee'],
                 ['مكان للوحدة الخارجية عليه هوا، مسار للمواسير، ميل لخرطوم الصرف، والمواسير الزيادة بتتحسب.', 'A ventilated spot for the outdoor unit, a route for the pipes, a fall on the drain hose, and extra piping is charged.']],
                [['سخان غاز / كهربا', 'Gas / electric water heater'], ['أيوه', 'Yes'], ['فنى معتمد', 'An approved technician'],
                 ['تعليق قوى، محبس، صمام أمان، تهوية للسخان الغاز، وخط كهربا مخصص للكهربائى.', 'A strong mounting, an isolating valve, a safety valve, ventilation for gas, and a dedicated circuit for electric.']],
                [['غسالة أطباق', 'Dishwasher'], ['أيوه — مياه وصرف', 'Yes — water and drain'], ['فنى', 'A technician'],
                 ['مكان بمقاس مظبوط لو مدمجة، ونقطة مياه وصرف قريبة.', 'An exact opening if it is built in, and a nearby water and drain point.']],
                [['تليفزيون', 'Television'], ['اختيارى — تعليق على الحيطة', 'Optional — wall mounting'], ['حسب الاتفاق مع البائع', 'By agreement with the seller'],
                 ['نوع الحيطة والحامل، ومسار الكابلات والبريزة.', 'The wall type and bracket, and the route for cables and a socket.']],
              ]),
            note('warn',
              'التركيب بواسطة حد غير معتمد ممكن يسقط الضمان، خصوصاً فى التكييف والسخانات والبوتاجاز. اسأل عن التركيب وانت بتشترى، مش يوم التسليم — واحتفظ بإيصال التركيب.',
              'Installation by someone unauthorised can void the warranty, especially for air conditioners, water heaters and cookers. Ask about installation while you are buying, not on delivery day — and keep the installation receipt.'),
            links([['الضمان والاسترجاع', 'Warranty & returns', 'warranty.html']]),
          ],
        },
        {
          id: 'after',
          h: ['لو الميعاد اتأخر أو حصلت مشكلة', 'If the appointment slips or something goes wrong'],
          blocks: [
            p('مفيش نظام تتبع أونلاين على الموقع ده، ومش هنعرض لك حالة شحنة وهمية. أسرع طريق هو المعرض اللى طلبت منه أو الخط الساخن ' + TEL + '، ومعاك رقم الطلب أو الفاتورة.',
              'There is no online tracking system on this site and we are not going to show you a fake shipment status. The fastest route is the showroom you ordered from, or the hotline ' + TEL + ', with your order or invoice number to hand.'),
            ul([
              ['لو الطلب اتأكد واتسلّم لشركة شحن، اسأل خدمة العملاء على رقم الشحنة وطريقة تتبعها.', 'If the order has been confirmed and handed to a courier, ask customer care for the shipment number and how to track it.'],
              ['الطلبات المحفوظة على الموقع ده متخزنة فى متصفحك، وبتتأكد بمكالمة — مش بتوصل لحد لوحدها.', 'Orders saved on this site are stored in your browser and are confirmed by a phone call — they do not reach anyone on their own.'],
              ['اطلب رقم مرجعى واحتفظ بيه، واحتفظ بأى رسالة بعتّها.', 'Ask for a reference number and keep it, along with any message you sent.'],
            ]),
            todo('ما فيش مدة تنفيذ (SLA) معتمدة منشورة للتوصيل أو التركيب على النسخة دى. الميعاد بيتحدد مع المعرض أو خدمة العملاء.',
              'No approved delivery or installation lead time (SLA) is published in this preview. The appointment is agreed with the showroom or customer care.'),
            links([
              ['طلباتى', 'My orders', 'orders.html'],
              ['مركز خدمة العملاء', 'Customer care', 'care.html'],
              ['اتصل ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
            ]),
          ],
        },
      ],
    },

    /* ------------------------------------------------------------------ */
    privacy: {
      sections: [
        {
          id: 'short',
          h: ['الخلاصة فى ست نقط', 'The whole thing in six lines'],
          sub: ['الصفحة دى بتوصف اللى الموقع ده بيعمله فعلاً، مش اللى المواقع بتقوله عادةً.',
            'This page describes what this site actually does, not what sites usually say.'],
          blocks: [
            ul([
              ['لو عملت حساب: الاسم والإيميل والتليفون وعنوان التوصيل بيتخزنوا على سيرفر صادكو نفسه عشان تقدر تدخل وتعمل طلب.', 'If you create an account: your name, e-mail, phone and delivery address are stored on SADKO’s own server so you can sign in and place an order.'],
              ['خطط التجهيز، والمنتجات المحفوظة، وأجهزتك، والسلة، والتقييمات والأسئلة اللى بتكتبها — كل دى فى متصفحك انت، على جهازك، وما بتترفعش لأى مكان. ولو عرّفتنا على مكانك من غير ما تعمل حساب، بيتحفظ على جهازك كمان — وأول ما تعمل حساب بيتنقل معاك.', 'Shopping plans, saved products, your appliances, the cart, and the reviews and questions you write all live in your own browser on your device and are not uploaded anywhere. If you describe a place without creating an account, that also stays on your device — and moves across with you when you do create one.'],
              ['مقارنة الأسعار بتجيب صفحات منتجات عامة من متاجر مدعومة — بحث عن منتج، مش عنك انت.', 'Price comparison fetches public product pages from supported stores — a search about a product, not about you.'],
              ['ما فيش أى بيانات بطاقات على الموقع ده خالص: لا رقم كارت، ولا CVV، ولا صفحة دفع.', 'No card details anywhere on this site at all: no card number, no CVV, no payment page.'],
              ['لو دخلت بحساب جوجل: بناخد منهم اسمك وإيميلك بس — ما بنشوفش باسورد جوجل ولا بنوصل لأى حاجة تانية فى حسابك.', 'If you sign in with Google: we receive only your name and e-mail — we never see your Google password and cannot reach anything else in your account.'],
              ['ما فيش تتبع إعلانى ولا تحليلات طرف تالت على الصفحات دى.', 'No advertising trackers and no third-party analytics on these pages.'],
              ['الخطوط بتتحمّل من Google Fonts، يعنى جوجل بيشوف طلب تحميل الخط (والـ IP بتاعه) زى أى موقع بيستخدمها.', 'Fonts load from Google Fonts, so Google sees the font request (and its IP) as with any site that uses them.'],
            ]),
          ],
        },
        {
          id: 'account',
          h: ['الحساب — إيه اللى بيتخزن على السيرفر', 'The account — what is stored on the server'],
          blocks: [
            p('نظام الحسابات فى صادكو بيشتغل على السيرفر بتاع الموقع نفسه، مش على خدمة خارجية. ده مقصود: باسورد متخزن فى المتصفح مش بيحمى حاجة.',
              'SADKO’s account system runs on the site’s own server, not on an outside service. That is deliberate: a password kept in the browser protects nothing.'),
            defs([
              ['البيانات الأساسية', 'Core details', 'الاسم، الإيميل، رقم التليفون، وعنوان التوصيل (لو دخّلته).', 'Name, e-mail, phone number, and delivery address if you entered one.'],
              ['أماكنك (اختيارى)', 'Your places (optional)', 'تقدر تحفظ أكتر من مكان — شقة، شاليه، أو أوضة لوحدها — وكل واحد فيه إجابات زى عدد الأفراد، نوع السكن، الدور والأسانسير، عرض أضيق باب، مقاسات الأماكن الفاضية، نوع الغاز، والميزانية التقريبية. كلها اختيارية، وبتستخدم فى فلترة المنتجات وترشيحات «ساعدنى أختار» بس.', 'You can keep several places — a flat, a chalet, or a single room — each with answers such as household size, property type, floor and lift, narrowest doorway width, the gaps appliances must fit, gas supply, and a rough budget. All optional, and used only to filter products and to shape the guided finder.'],
              ['الدخول بمزوّد خارجى', 'Provider sign-in', 'لو استخدمت «الدخول بجوجل»، بنخزن إن الحساب ده مربوط بجوجل ورقم المستخدم عندهم وإيميلك المتحقق منه. ما بنخزنش أى توكن من جوجل، ولا بنطلب صلاحيات غير الاسم والإيميل.', 'If you use “Continue with Google”, we store that the account is linked to Google, your user id there, and your verified e-mail. We store no Google token and request no permission beyond name and e-mail.'],
              ['الباسورد', 'Password', 'ما بيتخزنش أبداً كنص. بيتخزن كـ scrypt hash بملح عشوائى لكل مستخدم، والمقارنة بتتم بطريقة آمنة زمنياً.', 'Never stored as text. It is stored as a scrypt hash with a per-user random salt, and comparison is timing-safe.'],
              ['الجلسة', 'The session', 'كوكى HttpOnly + SameSite (وSecure على HTTPS)، والسيرفر بيخزن الهاش بتاعه مش التوكن نفسه — يعنى سكريبت الصفحة مش بيقدر يقراه.', 'An HttpOnly + SameSite cookie (Secure over HTTPS); the server stores only its hash, not the token itself — so page scripts cannot read it.'],
              ['الطلبات', 'Orders', 'لو عملت طلب: المنتجات، وبيانات التوصيل، وطريقة دفع بدون بطاقات. رسوم التوصيل والتركيب بتفضل فاضية لحد ما خدمة العملاء تأكدها.', 'If you place an order: the items, the delivery details, and a non-card payment method. Delivery and installation fees stay blank until customer care confirms them.'],
            ]),
            note('info',
              'فى النسخة التجريبية دى أغلب الصفحات بتشتغل من غير تسجيل دخول أصلاً — يعنى لو ما عملتش حساب، ما فيش بيانات شخصية بتاعتك على أى سيرفر من الموقع ده.',
              'In this preview most pages work without signing in at all — so if you do not create an account, this site holds no personal data of yours on any server.'),
            todo('مدة الاحتفاظ بالبيانات، والمسؤول عن حماية البيانات فى صادكو، وإجراء طلب نسخة من بياناتك — كلها محتاجة اعتماد رسمى من الشركة قبل ما تتكتب هنا كالتزام.',
              'The data-retention period, SADKO’s data-protection contact, and the procedure for requesting a copy of your data all need formal company sign-off before being written here as a commitment.'),
          ],
        },
        {
          id: 'local',
          h: ['اللى متخزن فى متصفحك انت', 'What is stored in your own browser'],
          sub: ['الحاجات دى بتتحفظ فى localStorage على جهازك. ما بتترفعش، وما بتتشافش من صادكو، وبتتمسح لو مسحت بيانات المتصفح.',
            'These live in localStorage on your device. They are not uploaded, SADKO cannot see them, and they disappear if you clear your browser data.'],
          blocks: [
            table(
              [['المفتاح', 'Key'], ['فيه إيه', 'What it holds']],
              [
                [['sadko-cart-v1', 'sadko-cart-v1'], ['سلة التسوق: المنتجات اللى ضفتها والكميات.', 'The shopping cart: the products you added and their quantities.']],
                [['sadko-saved-v1', 'sadko-saved-v1'], ['المنتجات المحفوظة والسعر وقت الحفظ عشان نوريك التغيّر.', 'Saved products and the price at the time you saved them, so we can show the change.']],
                [['sadko-plans-v1', 'sadko-plans-v1'], ['خطط التجهيز: الأجهزة والميزانية والملاحظات.', 'Shopping plans: appliances, budget and notes.']],
                [['sadko-owned-v1', 'sadko-owned-v1'], ['أجهزتك المسجّلة: الموديل، السيريال، تاريخ الشراء، ومدة الضمان.', 'Your recorded appliances: model, serial, purchase date and warranty length.']],
                [['sadko-profile-v1', 'sadko-profile-v1'], ['إجابات ملف البيت لو جاوبتها من غير حساب.', 'Home-profile answers if you filled them in without an account.']],
                [['sadko-qa-v1 / sadko-reviews-v1', 'sadko-qa-v1 / sadko-reviews-v1'], ['الأسئلة والتقييمات اللى بتكتبها — بتتحفظ محلياً وما بتتنشرش لحد.', 'The questions and reviews you write — kept locally and not published to anyone.']],
                [['sadko-lang', 'sadko-lang'], ['لغة العرض: عربى ولا إنجليزى.', 'The display language: Arabic or English.']],
                [['sadko-guide-v1 / sadko-hs-coach-v1', 'sadko-guide-v1 / sadko-hs-coach-v1'], ['علامة إنك شوفت جولة التعريف على الصفحة الرئيسية، عشان ما تتكررش.', 'A flag that you have seen the home-page walkthrough, so it does not repeat.']],
              ]),
            note('warn',
              'لأن ده تخزين محلى: لو مسحت بيانات المتصفح، أو فتحت الموقع من جهاز تانى أو من نافذة تصفّح خفى، الحاجات دى مش هتكون موجودة. مفيش مزامنة بين الأجهزة.',
              'Because this is local storage: if you clear browser data, or open the site on another device or in a private window, none of it will be there. There is no sync between devices.'),
          ],
        },
        {
          id: 'compare',
          h: ['مقارنة الأسعار', 'Price comparison'],
          blocks: [
            p('لما تعمل مقارنة، بيتبعت اسم المنتج اللى بتدوّر عليه لسيرفر الموقع، والسيرفر بيجيب صفحات المنتجات العامة من قائمة متاجر مدعومة ويقرا منها السعر والعنوان. ده بحث عن منتج — مش بيتبعت معاه اسمك ولا تليفونك ولا سلتك.',
              'When you run a comparison, the product name you are searching for is sent to the site’s server, and the server fetches public product pages from a list of supported stores and reads the price and title from them. That is a product search — your name, phone and cart are not sent with it.'),
            ul([
              ['المتاجر المدعومة بتشوف طلب زيارة لصفحاتها العامة، زى أى زيارة عادية للصفحة.', 'Supported stores see a request for their public pages, like any ordinary page visit.'],
              ['لو ضغطت على عرض من متجر تانى وخرجت لموقعه، بقيت على موقعه هو وسياسة الخصوصية بتاعته هى اللى بتسرى.', 'If you click an offer from another store and leave, you are on their site and their privacy policy applies.'],
              ['نتايج المقارنة بتتعرض فى الصفحة، وما بتترفعش لأى ملف شخصى.', 'Comparison results are shown on the page and are not attached to any profile.'],
            ]),
            links([['مقارنة الأسعار', 'Price comparison', 'compare.html'], ['شروط الاستخدام', 'Terms of use', 'terms.html']]),
          ],
        },
        {
          id: 'payments',
          h: ['بيانات الدفع', 'Payment details'],
          blocks: [
            note('info',
              'ما بنجمعش ولا بنخزّن ولا بنمرّر أى بيانات بطاقات على الموقع ده. مفيش صفحة دفع ولا خانة رقم كارت ولا CVV فى أى مكان. الطلبات بتتأكد بمكالمة، والدفع بيتم مع البائع بالطرق اللى هو بيقولها لك (زى الدفع عند الاستلام أو فى المعرض).',
              'We do not collect, store or pass on any card details on this site. There is no payment page, no card-number field and no CVV anywhere. Orders are confirmed by phone, and payment happens with the seller by the methods they tell you (such as cash on delivery or in the showroom).'),
            p('لو أى صفحة على الموقع ده طلبت منك بيانات بطاقة، دى مش صفحة بتاعتنا — متدخلهاش وكلّمنا على ' + TEL + '.',
              'If any page on this site ever asks you for card details, it is not ours — do not enter them, and call us on ' + TEL + '.'),
          ],
        },
        {
          id: 'third',
          h: ['التتبع والأطراف التانية', 'Tracking and third parties'],
          blocks: [
            ul([
              ['ما فيش تحليلات طرف تالت ولا بكسل إعلانى ولا كوكيز تتبع على الصفحات دى.', 'No third-party analytics, advertising pixels or tracking cookies on these pages.'],
              ['الخطوط (Cairo) بتتحمّل من fonts.googleapis.com و fonts.gstatic.com. جوجل بيشوف طلب الخط والـ IP اللى طلبه — لو ده مهم لك، أدوات حجب الطلبات الخارجية بتوقفه والموقع بيفضل شغّال بخط بديل.', 'The Cairo font loads from fonts.googleapis.com and fonts.gstatic.com. Google sees the font request and the IP that made it — if that matters to you, a blocker will stop it and the site still works with a fallback font.'],
              ['صور المنتجات ممكن تتحمّل من نفس السيرفرات اللى الكتالوج اتقرا منها.', 'Product images may load from the same servers the catalogue was read from.'],
              ['روابط زى موقع شركة الشحن أو مواقع المتاجر التانية بتوديك لمواقع ملهاش علاقة بينا، وسياساتها بتاعتها.', 'Links such as a courier’s site or other stores take you to sites unrelated to us, under their own policies.'],
            ]),
          ],
        },
        {
          id: 'delete',
          h: ['إزاى تمسح بياناتك', 'How to delete your data'],
          blocks: [
            ol([
              ['الحاجات المحلية (السلة، المحفوظات، الخطط، أجهزتك، التقييمات): امسح بيانات الموقع من إعدادات المتصفح — Clear site data لـ نطاق الموقع ده. ده بيمسحها فوراً وبالكامل.', 'Local items (cart, saved products, plans, appliances, reviews): clear site data for this site’s domain from your browser settings. That removes them immediately and completely.'],
              ['كل صفحة فيها بيانات محفوظة عندها زرار مسح خاص بيها كمان (امسح الخطة، شيل الجهاز، فضّى السلة).', 'Each page that holds saved data also has its own delete control (delete the plan, remove the appliance, empty the cart).'],
              ['الحساب على السيرفر (لو عامل واحد): اطلب حذفه من خدمة العملاء على ' + TEL + ' أو ' + MAIL + '، واذكر الإيميل المسجّل بيه.', 'The server account (if you created one): ask customer care to delete it on ' + TEL + ' or ' + MAIL + ', quoting the registered e-mail.'],
            ]),
            todo('مدة تنفيذ طلب الحذف وإجراءات التحقق من هوية صاحب الطلب محتاجين اعتماد من صادكو — لسه مش منشورين.',
              'The turnaround for a deletion request and the identity checks around it need SADKO sign-off — they are not published yet.'),
            links([['مركز خدمة العملاء', 'Customer care', 'care.html'], ['اتصل ' + TEL, 'Call ' + TEL, 'tel:' + TEL]]),
          ],
        },
      ],
    },

    /* ------------------------------------------------------------------ */
    terms: {
      sections: [
        {
          id: 'use',
          h: ['استخدام الموقع', 'Using this site'],
          blocks: [
            p('الموقع ده نسخة معاد تصميمها (Rebrand Preview) لصادكو جروب، بيعرض كتالوج منتجات وأدوات تساعدك تختار: ترشيحات، مقارنة أسعار، أدلة شراء، وخطط تجهيز. استخدامك للموقع معناه إنك موافق على الإرشادات المكتوبة هنا.',
              'This site is a rebrand preview for SADKO Group. It presents a product catalogue and tools that help you choose: recommendations, price comparison, buying guides and shopping plans. Using the site means you accept the guidance set out here.'),
            ul([
              ['استخدم الموقع للأغراض الشخصية والمشروعة بس.', 'Use the site for personal, lawful purposes only.'],
              ['متحاولش تسحب الكتالوج آلياً، أو تحمّل السيرفر بطلبات كتيرة، أو تعطّل الخدمة.', 'Do not scrape the catalogue automatically, overload the server with requests, or disrupt the service.'],
              ['المحتوى اللى بتكتبه (تقييم أو سؤال) لازم يكون بلا إساءة، وهو محفوظ فى متصفحك انت أصلاً.', 'Anything you write (a review or a question) must be free of abuse — and it is kept in your own browser anyway.'],
            ]),
          ],
        },
        {
          id: 'prices',
          h: ['الأسعار والتوافر', 'Prices and availability'],
          blocks: [
            p('الأسعار المعروضة مأخوذة من صفحات المنتجات وقت آخر تحديث للكتالوج، وممكن تكون اتغيّرت من ساعتها. عرض السعر هنا مش عرض بيع ملزم، والسعر النهائى هو اللى بيتأكد فى المعرض أو من خدمة العملاء وقت الطلب.',
              'Prices shown are taken from product pages at the time of the catalogue’s last update and may have changed since. A price here is not a binding offer; the final price is the one confirmed in the showroom or by customer care when you order.'),
            ul([
              ['التوافر بيتغيّر بسرعة — اسأل قبل ما تتحرك للمعرض.', 'Availability changes quickly — ask before travelling to a showroom.'],
              ['الصور استرشادية، واللون أو الملحقات ممكن يختلفوا حسب الموديل.', 'Images are indicative; colour or accessories may differ by model.'],
              ['رسوم التوصيل والتركيب مش داخلة فى السعر المعروض إلا لو مكتوب كده صراحة فى وصف المنتج.', 'Delivery and installation fees are not included in the shown price unless the product description says so explicitly.'],
            ]),
            links([['التوصيل والتركيب', 'Delivery & installation', 'delivery.html']]),
          ],
        },
        {
          id: 'specs',
          h: ['المواصفات مقروءة آلياً — وده معناه فيه ثغرات', 'Specifications are read automatically — which means there are gaps'],
          blocks: [
            p('المواصفات اللى بتشوفها فى الجداول والمقارنات (السعة، المقاسات، كفاءة الطاقة، اللون، الخصائص) مستخرجة آلياً من عناوين وأوصاف المنتجات. لما الوصف ما يذكرش حاجة، بتظهر «غير متوفر» — ودى معناها إحنا مش عارفين، مش إن الجهاز ما فيهوش الخاصية دى.',
              'The specifications you see in tables and comparisons (capacity, dimensions, energy rating, colour, features) are extracted automatically from product titles and descriptions. When a description does not mention something it shows as "غير متوفر" (not available) — which means we do not know, not that the appliance lacks it.'),
            note('warn',
              'قبل ما تشترى بناءً على رقم معيّن — مقاس، سعة، كفاءة طاقة، مدة ضمان — أكّده من صفحة المنتج الأصلية أو من خدمة العملاء على ' + TEL + '. القراءة الآلية ممكن تغلط.',
              'Before you buy on the strength of a particular figure — a dimension, a capacity, an energy rating, a warranty period — confirm it against the original product page or with customer care on ' + TEL + '. Automatic reading can get it wrong.'),
          ],
        },
        {
          id: 'compare',
          h: ['مقارنة الأسعار', 'Price comparison'],
          blocks: [
            ul([
              ['المقارنة بتغطى قائمة محددة من المتاجر المدعومة، مش كل المتاجر فى مصر — يعنى ممكن يكون فيه سعر أحسن فى مكان مش مغطى.', 'Comparison covers a specific list of supported stores, not every store in Egypt — there may be a better price somewhere not covered.'],
              ['النتايج بتتجمّع لحظياً من صفحات عامة، وممكن تكون ناقصة أو متأخرة لو المتجر غيّر شكل صفحاته أو كان مش متاح.', 'Results are gathered live from public pages and can be incomplete or stale if a store changes its page layout or is unavailable.'],
              ['مطابقة المنتجات تقريبية: ممكن موديلين قريبين يتعرضوا مع بعض، فراجع الموديل بالظبط قبل ما تقارن السعر.', 'Product matching is approximate: two similar models can appear side by side, so check the exact model before comparing price.'],
              ['أى شراء من متجر تانى بيتم بينك وبينه هو. الضمان والتوصيل والاسترجاع والفاتورة كلها بتاعته، وصادكو مش طرف فى العملية.', 'Any purchase from another store is between you and them. Warranty, delivery, returns and the invoice are all theirs, and SADKO is not a party to it.'],
            ]),
            links([['الضمان والاسترجاع', 'Warranty & returns', 'warranty.html'], ['مقارنة الأسعار', 'Price comparison', 'compare.html']]),
          ],
        },
        {
          id: 'advice',
          h: ['الترشيحات والأدلة إرشادية', 'Recommendations and guides are guidance'],
          blocks: [
            p('«ساعدنى أختار» بيرشّح بناءً على إجاباتك وعلى بيانات الكتالوج، وبيكتب لك سبب كل ترشيح. ده رأى استرشادى يساعدك تضيّق الاختيارات — مش استشارة هندسية ولا كهربائية ولا تقدير رسمى لاحتياجك.',
              'The guided finder recommends based on your answers and the catalogue data, and writes out the reason for each suggestion. That is guidance to narrow your options — not engineering or electrical advice, and not a formal assessment of your needs.'),
            ul([
              ['أرقام المساحات والسعات فى الأدلة قواعد تقريبية شائعة، والرقم الملزم هو اللى فى كتيّب الموديل.', 'The area and capacity figures in the guides are common rules of thumb; the binding number is in the model’s manual.'],
              ['شغل الغاز والكهربا والتركيب لازم يعمله فنى مؤهل — الأدلة بتقولك تسأل عن إيه، مش بتخليك تعمله بنفسك.', 'Gas, electrical and installation work must be done by a qualified technician — the guides tell you what to ask about, not how to do it yourself.'],
            ]),
            links([['ساعدنى أختار', 'Help me choose', 'finder.html'], ['أدلة الشراء', 'Buying guides', 'guides.html']]),
          ],
        },
        {
          id: 'orders',
          h: ['الطلبات والإلغاء', 'Orders and cancellation'],
          blocks: [
            p('السلة والطلبات المحفوظة على الموقع ده وسيلة تنظيم: بتجمّع اللى انت عايزه وبتجهّزه فى صيغة تبعتها أو تقراها فى مكالمة. الطلب ما بيتحوّلش لعقد بيع غير لما يتأكد مع صادكو (بمكالمة على ' + TEL + ' أو فى المعرض).',
              'The cart and saved orders on this site are an organising tool: they gather what you want and put it in a form you can send or read out on a call. An order does not become a contract of sale until it is confirmed with SADKO (by a call on ' + TEL + ' or in a showroom).'),
            ul([
              ['رسوم التوصيل والتركيب بتتأكد قبل التنفيذ، ومش بتتحسب أوتوماتيك على الموقع.', 'Delivery and installation fees are confirmed before the work and are not calculated automatically on the site.'],
              ['الإلغاء أو التعديل قبل التنفيذ بيتم بمكالمة على ' + TEL + ' — أسرع ما تقدر، خصوصاً لو الجهاز اتحدّدله ميعاد تركيب.', 'Cancelling or amending before fulfilment is done by calling ' + TEL + ' — as early as you can, especially once an installation slot is booked.'],
              ['الإلغاء بعد التسليم أو بعد التركيب بيتحكمه شرط الاسترجاع عند البائع.', 'Cancelling after delivery or after installation is governed by the seller’s return conditions.'],
            ]),
            todo('شروط الإلغاء والاسترجاع الرسمية، وأى رسوم مرتبطة بيها، محتاجة اعتماد من صادكو. لحد ما تتنشر، اسأل خدمة العملاء قبل ما تشترى.',
              'The formal cancellation and return conditions, and any fees attached to them, need SADKO sign-off. Until they are published, ask customer care before buying.'),
            links([['طلباتى', 'My orders', 'orders.html'], ['مركز خدمة العملاء', 'Customer care', 'care.html']]),
          ],
        },
        {
          id: 'ip',
          h: ['الملكية الفكرية', 'Intellectual property'],
          blocks: [
            ul([
              ['تصميم الموقع ونصوصه وأدلته من إنتاج صادكو جروب، ومش مسموح إعادة نشرها تجارياً من غير إذن.', 'The site’s design, its text and its guides are produced by SADKO Group and may not be republished commercially without permission.'],
              ['أسماء الماركات وشعاراتها ملك أصحابها، وذكرها هنا للتعريف بالمنتجات بس.', 'Brand names and logos belong to their owners and are used here only to identify products.'],
              ['صور وأوصاف المنتجات مصدرها صفحات المنتجات نفسها وحقوقها لأصحابها.', 'Product images and descriptions come from the product pages themselves and their rights belong to their owners.'],
              ['لو شايف محتوى منشور هنا بالغلط أو بيخالف حقك، كلّمنا على ' + MAIL + ' ونصلّحه.', 'If you believe content here is published in error or infringes your rights, contact us on ' + MAIL + ' and we will fix it.'],
            ]),
          ],
        },
        {
          id: 'changes',
          h: ['تعديل الشروط والتواصل', 'Changes and contact'],
          blocks: [
            p('الصفحة دى ممكن تتعدّل مع تطوّر الموقع، وتاريخ آخر تحديث مكتوب فوق. لو فيه تعارض بين اللى مكتوب هنا وبين فاتورتك أو كارت الضمان أو سياسة البائع، الفاتورة وكارت الضمان وسياسة البائع هى اللى بتسرى.',
              'This page may change as the site develops; the last-updated date is shown above. If anything here conflicts with your invoice, your warranty card or the seller’s policy, the invoice, the card and the seller’s policy prevail.'),
            todo('البيانات القانونية للشركة (السجل التجارى، البطاقة الضريبية، العنوان المسجّل) والصياغة القانونية النهائية للشروط مش مكتوبة هنا عن قصد — لأنها محتاجة تتيجى من صادكو نفسها متأكدة، مش تتألف.',
              'The company’s legal identifiers (commercial register, tax card, registered address) and the final legal wording of these terms are deliberately not written here — they must come from SADKO itself, verified, not invented.'),
            links([
              ['اتصل ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
              ['ابعت إيميل', 'Send an e-mail', 'mailto:' + MAIL],
              ['المعارض', 'Showrooms', 'showrooms.html'],
            ]),
          ],
        },
      ],
    },
  };

  /* ================= page chrome ================= */

  function topBlock(key, page) {
    const toc = page.sections.map(s =>
      '<a class="chip chip--mute" href="#' + E(key + '-' + s.id) + '">' + E(pick(s.h)) + '</a>').join('');
    return '<div class="panel info-top">' +
      block(BANNER) +
      '<p class="chips info-toc" aria-label="' + E(t('محتويات الصفحة', 'On this page')) + '">' + toc + '</p>' +
      '<p class="info-updated">' + E(t('آخر تحديث', 'Last updated')) + ': ' +
      '<time datetime="' + UPDATED + '">' + E(A() ? A().date(UPDATED) : UPDATED) + '</time></p>' +
      '</div>';
  }

  function section(key, s) {
    return '<section class="panel" id="' + E(key + '-' + s.id) + '">' +
      '<h2 class="panel__h">' + E(pick(s.h)) + '</h2>' +
      (s.sub ? '<p class="panel__sub">' + E(pick(s.sub)) + '</p>' : '') +
      '<div class="doc">' + s.blocks.map(block).join('') + '</div>' +
      '</section>';
  }

  function crossLinks(key) {
    const items = Object.keys(XLINKS).filter(k => k !== key).map(k => XLINKS[k]);
    items.push(['مركز خدمة العملاء', 'Customer care', 'care.html']);
    items.push(['أدلة الشراء', 'Buying guides', 'guides.html']);
    items.push(['المعارض', 'Showrooms', 'showrooms.html']);
    return '<section class="panel info-x">' +
      '<h2 class="panel__h">' + E(t('صفحات تانية تهمك', 'Other pages you may need')) + '</h2>' +
      '<p class="panel__sub">' + E(t('صفحات المعلومات الأربعة بتكمّل بعض، وخدمة العملاء على ' + TEL + ' هى اللى بتأكد أى تفصيلة.',
        'The four information pages complement each other, and customer care on ' + TEL + ' confirms any detail.')) + '</p>' +
      block(links(items)) +
      '</section>';
  }

  /* ================= mount ================= */
  function mountInfo(root, key) {
    if (!root) return;
    const page = PAGES[key];
    if (!page) {
      root.innerHTML = '<div class="empty"><p>' +
        E(t('الصفحة دى مش موجودة.', 'This page does not exist.')) + '</p></div>';
      return;
    }
    injectCSS();
    root.innerHTML =
      topBlock(key, page) +
      page.sections.map(s => section(key, s)).join('') +
      crossLinks(key);
  }

  window.mountInfo = mountInfo;
})();
