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
  /* needs('compare', x): x (a section, block or list item) only shows while
     nav.js has that page switched on (skFeature). Links to a switched-off page
     are dropped by the renderer on their own. */
  const needs = (feature, x) => Object.assign(x, { needs: feature });
  const shown = x => !x.needs || !window.skFeature || window.skFeature.on(x.needs);
  const linkShown = i => !window.skFeature || !window.skFeature.hidden(i[2]);

  const pick = pair => t(pair[0], pair[1]);

  /* ================= block renderer ================= */
  function block(b) {
    switch (b.t) {
      case 'p':
        return '<p>' + E(t(b.ar, b.en)) + '</p>';
      case 'h':
        return '<h3>' + E(t(b.ar, b.en)) + '</h3>';
      case 'ul':
        return '<ul>' + b.items.filter(shown).map(i => '<li>' + E(pick(i)) + '</li>').join('') + '</ul>';
      case 'ol':
        return '<ol>' + b.items.filter(shown).map(i => '<li>' + E(pick(i)) + '</li>').join('') + '</ol>';
      case 'note':
        return '<p class="note note--' + (b.k || 'info') + '">' + E(t(b.ar, b.en)) + '</p>';
      case 'todo':
        return '<div class="note note--warn doc-flag">' +
          '<span class="badge badge--amber">' + E(t('محتاج اعتماد صادكو', 'Needs SADKO sign-off')) + '</span>' +
          '<span>' + E(t(b.ar, b.en)) + '</span></div>';
      case 'links':
        if (!b.items.some(linkShown)) return '';
        return '<p class="chips">' + b.items.filter(linkShown).map(i =>
          '<a class="chip" href="' + E(hrefOf(i[2])) + '">' + E(pick(i)) + '</a>').join('') + '</p>';
      case 'table':
        return '<div class="doc-scroll"><table class="tbl"><thead><tr>' +
          b.head.map(c => '<th scope="col">' + E(pick(c)) + '</th>').join('') +
          '</tr></thead><tbody>' +
          b.rows.filter(shown).map(r => '<tr>' + r.map((c, i) => i === 0
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
    'هذه الصفحة إرشادات مكتوبة للنسخة التجريبية من موقع صادكو (Rebrand Preview)، وليست نصاً قانونياً معتمداً. الشروط الملزمة هى المكتوبة فى الفاتورة وبطاقة الضمان وسياسة البائع الذى اشتريت منه. وأى مدة أو رسم أو رقم لا تجده هنا، اسأل خدمة العملاء على ' + TEL + ' بدلاً من الافتراض.',
    'This page is guidance written for the SADKO rebrand preview site. It is not approved legal text. The binding terms are the ones printed on your invoice, on the warranty card, and in the policy of the seller you bought from. If a period, a fee or a figure is not stated here, ask customer care on ' + TEL + ' rather than assume.');

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
        needs('compare', {
          id: 'seller',
          h: ['من هو البائع؟ هذا أهم سؤال فى الضمان', 'Who is the seller? That is the warranty question that matters'],
          sub: ['يعرض هذا الموقع أمرين مختلفين: منتجات تبيعها صادكو، ونتائج مقارنة أسعار من متاجر أخرى. والضمان والخدمة ليسا واحداً فى الحالتين.',
            'This site shows two different things: products sold by SADKO, and price-comparison results from other stores. Warranty and service are not the same in the two cases.'],
          blocks: [
            table(
              [['البند', 'Item'], ['اشتريت من صادكو', 'Bought from SADKO'], ['وجدته فى مقارنة الأسعار (متجر آخر)', 'Found via price comparison (another store)']],
              [
                [['من المسؤول عن الضمان', 'Who carries the warranty'],
                 ['ضمان المصنّع + خدمة ما بعد البيع من صادكو', 'The manufacturer’s warranty plus SADKO after-sales service'],
                 ['ضمان المصنّع + المتجر البائع. وصادكو ليست طرفاً فى هذه العملية', 'The manufacturer’s warranty plus that store. SADKO is not a party to it']],
                [['من يستقبل طلب الصيانة', 'Who takes the service request'],
                 ['خدمة عملاء صادكو على ' + TEL, 'SADKO customer care on ' + TEL],
                 ['خدمة عملاء المتجر الذى اشتريت منه', 'The customer care of the store you bought from']],
                [['الاسترجاع والاستبدال', 'Returns and exchange'],
                 ['سياسة صادكو، وبالفاتورة الصادرة منها', 'SADKO’s policy, against the invoice it issued'],
                 ['سياسة ذلك المتجر (وقد تكون مختلفة تماماً)', 'That store’s policy (it can be completely different)']],
                [['التوصيل والتركيب', 'Delivery and installation'],
                 ['حسب وصف المنتج، وبتأكيد من خدمة عملاء صادكو', 'Per the product description, confirmed by SADKO customer care'],
                 ['شروط ذلك المتجر ومواعيده ورسومه', 'That store’s terms, timing and fees']],
                [['الفاتورة', 'The invoice'],
                 ['فاتورة صادكو هى إثبات الشراء', 'A SADKO invoice is your proof of purchase'],
                 ['فاتورة ذلك المتجر هى إثباتك الوحيد. احتفظ بها', 'That store’s invoice is your only proof. Keep it']],
              ]),
            note('warn',
              'تعرض صادكو أسعار متاجر أخرى لترى السوق أمامك بوضوح، لكنها ليست وسيطاً فى ذلك البيع ولا طرفاً فى العقد. وإذا اشتريت من متجر آخر، فاسأله هو، قبل الدفع، عن الضمان والتركيب والاسترجاع، ولا تفترض أن شروطه مماثلة لشروط صادكو.',
              'SADKO shows other stores’ prices so you can see the market clearly, but it is not a broker in that sale and not a party to that contract. If you buy from another store, ask that store, before you pay, about warranty, installation and returns, and do not assume its terms match SADKO’s.'),
            note('info',
              'تفرّق صفحة «أجهزتى» بين الحالتين: عند تسجيل جهاز تحدد ما إذا كنت قد اشتريته من صادكو أو من متجر آخر، ويظل ذلك مسجَّلاً مع تاريخ الشراء والمدة المتبقية من الضمان.',
              'The "My appliances" page keeps the distinction: when you record an appliance you say whether it came from SADKO or another store, and that stays recorded alongside the purchase date and the remaining warranty.'),
            links([
              ['أجهزتى والضمان', 'My appliances & warranty', 'appliances.html'],
              ['مقارنة الأسعار', 'Price comparison', 'compare.html'],
            ]),
          ],
        }),
        {
          id: 'covers',
          h: ['ماذا يغطى ضمان المصنّع عادةً، وما الذى يقع خارجه', 'What a manufacturer warranty usually covers, and what it does not'],
          sub: ['هذا وصف عام لطريقة عمل ضمانات الأجهزة المنزلية فى مصر، وليس نص ضمان طراز بعينه. والنص الملزم هو الوارد فى بطاقة الضمان المرفقة بجهازك.',
            'This is a general description of how home-appliance warranties usually work in Egypt, not the text of any specific model’s warranty. The binding text is the warranty card that came with your appliance.'],
          blocks: [
            h('ما يشمله الضمان عادةً', 'Usually covered'),
            ul([
              ['عيوب التصنيع والمواد التى تظهر فى الاستخدام المنزلى الطبيعى.', 'Manufacturing and material defects that show up in normal domestic use.'],
              ['القطع التى تتعطل من تلقاء نفسها دون سبب خارجى.', 'Parts that fail on their own with no external cause.'],
              ['أجرة الإصلاح، غير أنها ليست مشمولة دائماً. اسأل صراحةً: هل الضمان قطع غيار فقط، أم قطع غيار وأجرة؟', 'The labour of the repair, but not always. Ask explicitly: is this parts only, or parts and labour?'],
              ['قطع رئيسية بمدة أطول أحياناً، مثل الضاغط فى الثلاجات والمحرّك فى الغسالات.', 'Sometimes a longer period on a major part, such as a refrigerator compressor or a washer motor.'],
            ]),
            h('ما يُستثنى عادةً', 'Usually excluded'),
            ul([
              ['الاستهلاك الطبيعى: الفلاتر، اللمبات، الجوانات، الفرش والملحقات.', 'Normal wear: filters, lamps, seals, brushes and accessories.'],
              ['الكسر، ودخول المياه، والحريق، وأى ضرر مادى بعد الاستلام.', 'Breakage, water ingress, fire and any physical damage after delivery.'],
              ['الحشرات والقوارض داخل الجهاز.', 'Insects and rodents inside the appliance.'],
              ['الاستخدام التجارى لجهاز مصنوع للاستخدام المنزلى (مطعم، محل، مغسلة).', 'Commercial use of an appliance built for the home (a restaurant, a shop, a laundry).'],
              ['الضرر الناتج عن تيار كهربائى غير مناسب أو تركيب خاطئ أو تشغيل مخالف لدليل الاستخدام.', 'Damage caused by unsuitable power, wrong installation, or operation contrary to the manual.'],
              ['المظهر الخارجى والخدوش التى لم تُسجَّل وقت الاستلام.', 'Cosmetic marks and scratches not recorded at the time of delivery.'],
            ]),
            note('info',
              'عبارة «ضمان ٥ سنوات» أو «١٠ سنوات» فى الإعلان تكون غالباً على قطعة واحدة (الضاغط أو المحرّك)، لا على الجهاز كله. اقرأ البطاقة وتبيَّن ما تغطيه كل مدة على وجه الدقة.',
              'A "5-year" or "10-year" warranty in an advert is usually on a single part (the compressor or the motor), not on the whole appliance. Read the card and see exactly what each period covers.'),
            todo('مدد الضمان الفعلية لكل علامة تجارية وطراز غير منشورة على هذا الموقع، لأن الكتالوج يُقرأ آلياً من أوصاف المنتجات وليس كل وصف يذكرها. والمدة الصحيحة هى الواردة فى بطاقة الضمان أو التى تؤكدها خدمة العملاء.',
              'Actual warranty periods per brand and model are not published on this site: the catalogue is read automatically from product descriptions and not every description states them. The correct period is the one on the warranty card, or the one customer care confirms.'),
            links([['دليل: كيف تقارن الضمانات على نحو صحيح', 'Guide: comparing warranties properly', 'guides.html?g=warranty-explained']]),
          ],
        },
        {
          id: 'papers',
          h: ['الفاتورة وبطاقة الضمان: لماذا هاتان الوثيقتان تحديداً', 'The invoice and the warranty card: why these two pieces of paper'],
          blocks: [
            p('يبدأ الضمان من تاريخ الشراء، والفاتورة هى الوثيقة الوحيدة التى تثبت هذا التاريخ. وبدونها يتحول الضمان إلى محل جدل. أما بطاقة الضمان فتحدد المدة والتغطية ومركز الخدمة المسؤول.',
              'A warranty runs from the date of purchase, and the invoice is the only thing that proves that date. Without it the warranty becomes an argument. The warranty card sets the period, the coverage and the service centre responsible.'),
            ul([
              ['صوّر الفاتورة وبطاقة الضمان بهاتفك من اليوم الأول، وأرسلهما إلى بريدك الإلكترونى.', 'Photograph the invoice and the warranty card on day one and e-mail them to yourself.'],
              ['صوّر لوحة البيانات على ظهر الجهاز (الطراز + الرقم التسلسلى). ستحتاج إليها فى كل مكالمة صيانة.', 'Photograph the rating plate on the back of the appliance (model + serial number). You will need it in every service call.'],
              ['إذا كان الضمان يتطلب تفعيلاً أو تسجيلاً خلال مدة محددة، فأنجزه فى الأسبوع نفسه.', 'If the warranty needs activation or registration within a period, do it the same week.'],
              ['واحتفظ بإيصال التركيب أيضاً، فهو يثبت أن التركيب تم بالطريقة المعتمدة.', 'Keep the installation receipt too: it proves the installation was done the approved way.'],
            ]),
            needs('appliances', note('soft',
              'تحفظ صفحة «أجهزتى» على هذا الموقع الطراز والرقم التسلسلى وتاريخ الشراء ومدة الضمان، وتحسب لك الأيام المتبقية. وهذه البيانات مخزَّنة فى متصفحك أنت (لا على خادم)، ومن ثم يظل عليك الاحتفاظ بنسختك من الصور والفاتورة الأصلية.',
              'The "My appliances" page stores the model, serial number, purchase date and warranty length, and counts the days left for you. That data lives in your own browser (not on a server), so you still need to keep your own copies of the invoice and photos.')),
            links([['سجّل جهازك فى «أجهزتى»', 'Record your appliance in "My appliances"', 'appliances.html']]),
          ],
        },
        {
          id: 'kinds',
          h: ['ضمان المصنّع، وضمان البائع، والتزامات البائع القانونية', 'Manufacturer warranty, seller warranty, and the seller’s legal obligations'],
          blocks: [
            defs([
              ['ضمان المصنّع', 'Manufacturer warranty',
               'تقدمه الشركة المصنّعة أو وكيلها فى مصر، ويُنفَّذ عن طريق مراكز الخدمة المعتمدة التابعة لها. والمدة والتغطية مكتوبتان فى بطاقة الضمان.',
               'Provided by the manufacturer or its agent in Egypt and carried out through its authorised service centres. The period and coverage are on the warranty card.'],
              ['ضمان البائع / المتجر', 'Seller / store warranty',
               'أى تغطية إضافية يقدمها المتجر نفسه (استبدال خلال فترة أولى، تركيب مجانى، صيانة دورية). وهى تختلف من متجر إلى آخر، ويجب أن تكون مكتوبة.',
               'Any extra cover the store itself offers (an early exchange, free installation, routine servicing). It differs between stores and should be in writing.'],
              ['ضمان ممتد مدفوع', 'Paid extended warranty',
               'منتج منفصل تشتريه. اسأل: هل يبدأ بعد ضمان المصنّع أم يسرى معه؟ وما الذى يغطيه على وجه الدقة؟ ومن الذى ينفّذه؟',
               'A separate product you buy. Ask: does it start after the manufacturer’s warranty or run alongside it? What exactly does it cover? Who performs it?'],
              ['التزامات البائع القانونية', 'The seller’s legal obligations',
               'حقوق المشترى قِبَل البائع فى القانون المصرى قائمة ومستقلة عن بطاقة الضمان. ولن نذكر لك أرقام مواد ولا مدداً دون مراجعة قانونية. وإذا احتجت تفاصيلها، فاسأل خدمة العملاء أو جهاز حماية المستهلك.',
               'A buyer’s rights against the seller under Egyptian law exist and are separate from the warranty card. We will not quote article numbers or periods here without legal review. For the detail, ask customer care or the consumer-protection authority.'],
            ]),
            todo('يحتاج نص الالتزامات القانونية والصياغة الرسمية للضمان إلى مراجعة قانونية واعتماد من صادكو قبل نشرهما كنص ملزم.',
              'The statutory-obligations text and the formal warranty wording need legal review and SADKO sign-off before they can be published as binding text.'),
          ],
        },
        {
          id: 'void',
          h: ['ما الذى يُسقط الضمان', 'What typically voids a warranty'],
          blocks: [
            ul([
              ['الإصلاح لدى فنى غير معتمد، أو استخدام قطع غيار غير أصلية، وهذا أكثر الأسباب شيوعاً على الإطلاق.', 'A repair by an unauthorised technician, or non-original spare parts (by far the most common reason).'],
              ['التركيب على يد شخص غير معتمد، خاصة فى التكييف والسخانات ومواقد الغاز.', 'Installation by someone unauthorised, especially for air conditioners, water heaters and gas cookers.'],
              ['توصيل الجهاز بجهد غير مناسب، أو إهمال شرط مكتوب فى دليل الاستخدام مثل استعمال منظّم جهد.', 'Connecting the appliance to unsuitable voltage, or ignoring a condition stated in the manual such as using a voltage stabiliser.'],
              ['ضرر وقع أثناء النقل بعد الاستلام، أو تشغيل جهاز تبريد فور نقله مائلاً.', 'Damage that happened in transport after you took delivery, or switching on a cooling appliance immediately after it was moved tilted.'],
              ['نزع ملصق الرقم التسلسلى أو طمسه، أو فتح الجهاز بنفسك.', 'Removing or defacing the serial-number label, or opening the appliance yourself.'],
              ['الاستخدام التجارى لجهاز منزلى.', 'Commercial use of a domestic appliance.'],
            ]),
            note('warn',
              'يجب فك مسامير النقل فى ظهر الغسالة قبل أول غسلة. فتشغيل الغسالة والمسامير مركّبة قد يُتلفها، وهذا التلف يقع غالباً خارج الضمان.',
              'The transit bolts at the back of a washing machine must be removed before the first wash. Running it with them still fitted can damage it, and that damage is usually outside the warranty.'),
          ],
        },
        {
          id: 'claim',
          h: ['كيف تبدأ طلب ضمان أو صيانة', 'How to start a warranty or service claim'],
          blocks: [
            ol([
              ['جهّز المستندات: الفاتورة، وبطاقة الضمان، والطراز والرقم التسلسلى، وتاريخ الشراء.', 'Get the paperwork ready: invoice, warranty card, model and serial number, and the purchase date.'],
              ['صوّر العطل نفسه أو سجّله بمقطع مصوَّر، فهذا يوفّر أحياناً زيارة كشف كاملة.', 'Photograph or video the fault itself. Sometimes it saves an entire diagnostic visit.'],
              ['حدّد البائع: أهو صادكو أم متجر آخر؟ فإن كان متجراً آخر، فاتصل به هو لا بنا.', 'Identify the seller: SADKO or another store? If it is another store, contact them, not us.'],
              ['إن كان البائع صادكو: اتصل على ' + TEL + '، أو أرسل بريداً إلكترونياً إلى ' + MAIL + ' مرفقاً به صور الفاتورة والعطل.', 'If it is SADKO: call ' + TEL + ', or e-mail ' + MAIL + ' attaching photos of the invoice and the fault.'],
              ['تجهّز لك صفحة «مركز خدمة العملاء» نص الطلب كاملاً بالبيانات المطلوبة لترسله بنفسك.', 'The customer care page prepares the full request text with the needed details, for you to send yourself.'],
              ['اطلب رقماً مرجعياً للطلب واحتفظ به، واحتفظ بنسخة من الرسالة التى أرسلتها.', 'Ask for a reference number and keep it, and keep a copy of the message you sent.'],
            ]),
            note('info',
              'لا يفتح هذا الموقع تذكرة صيانة تلقائياً ولا يتابعها، ولا يوجد نظام تتبع عبر الإنترنت. وما يقوم به هو تجهيز الطلب مكتوباً بصورة صحيحة. أما الإرسال والمتابعة فيتمان عبر الهاتف أو البريد الإلكترونى.',
              'This site does not open or track a service ticket automatically, and there is no online tracking system. What it does is prepare a properly written request. Sending and following up happen by phone or e-mail.'),
            links([
              ['مركز خدمة العملاء', 'Customer care', 'care.html'],
              ['أجهزتى والضمان', 'My appliances & warranty', 'appliances.html'],
              ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
              ['أرسل بريداً إلكترونياً', 'Send an e-mail', 'mailto:' + MAIL],
            ]),
          ],
        },
        {
          id: 'returns',
          h: ['الاسترجاع والاستبدال', 'Returns and exchange'],
          blocks: [
            p('يتم الاسترجاع والاستبدال مع البائع المذكور فى الفاتورة، لا مع الموقع. وتكون العملية أيسر كثيراً حين تكون العبوة والملحقات والفاتورة كلها لديك وبحالتها.',
              'Returns and exchanges are handled by the seller named on the invoice, not by the website. The process is far easier when the box, the accessories and the invoice are all with you and intact.'),
            ul([
              ['افحص الجهاز أمام فريق التوصيل قبل التوقيع، وسجّل أى خدش أو كسر فى إيصال الاستلام نفسه.', 'Inspect the appliance in front of the delivery team before you sign, and record any scratch or damage on the delivery note itself.'],
              ['الجهاز الذى رُكّب أو شُغّل تسرى عليه شروط مختلفة عن جهاز ما زال فى عبوته.', 'An appliance that has been installed or used is treated differently from one still in its box.'],
              needs('compare', ['إذا كان المنتج من متجر آخر عبر مقارنة الأسعار، فسياسة الاسترجاع الخاصة به هى التى تسرى.', 'If the product came from another store through price comparison, that store’s return policy applies.']),
            ]),
            todo('مدة الاسترجاع وشروطه المعتمدة من صادكو غير منشورة هنا، ولا يصح أن نخترعها. وإلى أن تُعتمد وتُكتب، اسأل خدمة العملاء على ' + TEL + ' قبل الشراء إذا كان الاسترجاع مهماً لك.',
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
          sub: ['هذه المعلومات مقروءة من أوصاف المنتجات فى الكتالوج نفسه، أى أنها تصف الغالب، لا وعداً يسرى على كل منتج.',
            'This is read from the product descriptions in the catalogue itself: it describes what is typical, not a promise on every product.'],
          blocks: [
            ul([
              ['القاهرة الكبرى والجيزة: التغطية الأساسية، ومعظم أوصاف المنتجات تذكر توصيلاً بدون رسوم إليهما.', 'Greater Cairo and Giza: the core coverage, and most product descriptions mention delivery at no charge there.'],
              ['الإسكندرية: مذكورة مع القاهرة والجيزة فى أوصاف التوصيل والتركيب.', 'Alexandria: named alongside Cairo and Giza in the delivery and installation notes.'],
              ['الساحل الشمالى: موسمى وعليه رسوم إضافية بحسب وصف المنتج، ومعرض مارينا نفسه يعمل فى الصيف فقط.', 'The North Coast: seasonal and with an extra fee per the product description; the Marina showroom itself opens only in summer.'],
              ['باقى المحافظات: غير مذكورة فى بيانات المنتجات، فاسأل خدمة العملاء على ' + TEL + ' قبل الطلب.', 'Other governorates: not stated in the product data, so ask customer care on ' + TEL + ' before ordering.'],
            ]),
            note('warn',
              'يختلف التوصيل والتركيب من منتج إلى آخر ومن محافظة إلى أخرى. وصفحة المنتج نفسها هى أدق مصدر، وأى تأكيد نهائى يتم مع خدمة العملاء أو المعرض.',
              'Delivery and installation differ by product and by governorate. The product page itself is the most accurate source, and final confirmation comes from customer care or the showroom.'),
            links([
              ['المعارض والفروع', 'Showrooms', 'showrooms.html'],
              ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
            ]),
          ],
        },
        {
          id: 'fees',
          h: ['الرسوم: ما نعرفه وما يجب أن تتأكد منه', 'Fees: what we know, and what you must confirm'],
          blocks: [
            defs([
              ['التوصيل المجانى', 'Free delivery',
               'تذكر أوصاف كثيرة فى الكتالوج «توصيلاً بدون رسوم» إلى القاهرة والجيزة والإسكندرية. وهذه العبارة مأخوذة من وصف المنتج، فتأكد من ورودها فى صفحة المنتج الذى تشتريه تحديداً.',
               'Many descriptions in the catalogue say delivery is free to Cairo, Giza and Alexandria. That sentence comes from the product description, so check it is present on the page of the exact product you are buying.'],
              ['رسوم الساحل الشمالى', 'North Coast fee',
               'التوصيل إلى الساحل موسمى وعليه رسوم إضافية بحسب وصف المنتج. أما قيمة الرسم نفسها فغير مذكورة فى البيانات. اسأل خدمة العملاء.',
               'North Coast delivery is seasonal and carries an extra fee per the product description. The amount itself is not in the data. Ask customer care.'],
              ['رسوم التركيب', 'Installation charges',
               'التركيب المتخصص (تكييف، سخان، موقد غاز) يُحتسب غالباً على حدة، ويكون أحياناً فى موعد غير موعد التوصيل. فاتفق على السعر قبل أن يبدأ الفنى.',
               'Specialist installation (air conditioner, water heater, gas cooker) is usually charged separately and often happens on a different day from delivery. Agree the price before the technician starts.'],
              ['حالات زيادة', 'Extras',
               'دور مرتفع بلا مصعد، أو مصعد أصغر من الجهاز، أو رفع من النافذة، أو مواسير نحاس زائدة عن المتفق عليه فى التكييف: كل ذلك يُحتسب إضافياً عادةً، ويُتفق عليه قبل يوم التوصيل لا فيه.',
               'A high floor with no lift, a lift smaller than the appliance, hoisting through a window, or copper piping beyond the agreed length on an air conditioner: these are normally charged extra, and are agreed before delivery day, not on it.'],
            ]),
            todo('لا يوجد جدول رسوم رسمى معتمد من صادكو منشور فى هذه النسخة، لا لرسوم الساحل ولا للتركيب ولا للحمل. وتُؤكَّد الأرقام مع خدمة العملاء قبل التنفيذ.',
              'There is no official SADKO fee table published in this preview, not for the North Coast, not for installation, not for carrying. Amounts are confirmed with customer care before the work is done.'),
            note('soft',
              'الطلبات التى تُحفظ من السلة على هذا الموقع تترك رسوم التوصيل والتركيب فارغة عن قصد، حتى لا نُثبت صفراً غير حقيقى فى مستند ستحتفظ به.',
              'Orders saved from the cart on this site deliberately leave delivery and installation fees blank, so that we do not print an untrue zero on a document you keep.'),
          ],
        },
        {
          id: 'before',
          h: ['قبل ميعاد التوصيل', 'Before the delivery date'],
          sub: ['أكثر ما يقع من مشكلات يوم التوصيل لا علاقة له بالجهاز: الجهاز سليم، لكنه لا يمر.',
            'The commonest delivery-day problem has nothing to do with the appliance: it is fine, it just does not fit through.'],
          blocks: [
            ol([
              ['قِس موضع الجهاز: العرض عند أضيق نقطة، والارتفاع حتى أقرب شىء فوقه، والعمق شاملاً القابس والباب مفتوحاً.', 'Measure the appliance’s space: width at the narrowest point, height to the nearest thing above, and depth including the plug and with the door open.'],
              ['وقِس الطريق كله: باب العمارة، والسلّم أو المصعد، وباب الشقة، وباب الغرفة. فأضيق نقطة هى الحاكمة.', 'Measure the whole route: building entrance, stairs or lift, flat door, room door. The narrowest point decides.'],
              ['إذا كان المصعد هو الطريق، فقِس عرض المقصورة وعمقها وارتفاعها وعرض بابها. وإذا كان السلّم، فانتبه إلى منعطف البسطة.', 'If the lift is the route, measure the car’s width, depth and height and its door. If it is the stairs, watch the turn at the landing.'],
              ['أخلِ الممر وموضع الجهاز، وارفع السجاد الذى قد يتمزق، وغطِّ الأثاث إن كان هناك ثقب بالمثقاب.', 'Clear the corridor and the appliance’s spot, lift rugs that could tear, and cover furniture if drilling is involved.'],
              ['وتأكد من وجود شخص بالغ فى الموعد ومعه رقم فريق التوصيل، والمبلغ إن كان الدفع عند الاستلام.', 'Make sure an adult will be there at the appointment with the delivery team’s number, and the payment if it is cash on delivery.'],
              ['وإذا كان للعمارة موعد محدد أو رسوم لإدخال البضائع، فأبلغ البائع من الآن لا يوم التسليم.', 'If your building has restricted hours or a fee for moving goods in, tell the seller now, not on the day.'],
            ]),
            note('warn',
              'إذا كان الفارق سنتيمتراً أو اثنين فقط، فلا تعتمد على أنها «ستمر». فك أبواب الجهاز أو الرفع من النافذة أمران ممكنان، لكنهما يكلفان مبلغاً إضافياً ويجب الاتفاق عليهما قبل الموعد.',
              'If the gap is only a centimetre or two, do not count on "it will fit". Removing the appliance’s doors or hoisting through a window are both possible, but they cost extra and must be agreed in advance.'),
            links([
              ['دليل: كيف تقيس المكان قبل الشراء', 'Guide: measure before you buy', 'guides.html?g=measure-before-you-buy'],
              ['دليل: تجهيز المنزل قبل التوصيل والتركيب', 'Guide: prepare for delivery & installation', 'guides.html?g=prepare-for-delivery'],
            ]),
          ],
        },
        {
          id: 'onday',
          h: ['يوم التوصيل: افحص قبل التوقيع', 'On delivery day: inspect before you sign'],
          blocks: [
            ul([
              ['افحص العبوة من الخارج أولاً: فأى انبعاج أو بلل فيها يعنى أن تفتحها وتتفقدها بحضورهم.', 'Check the outside of the box first: any dent or damp on the carton means you open and look while they are still there.'],
              ['افتحها وتأكد من الطراز واللون والمقاس، ومن الملحقات (خراطيم، أرفف، جهاز تحكم، مسامير).', 'Open it and confirm the model, colour and size, and the accessories (hoses, shelves, remote, bolts).'],
              ['سجّل أى خدش أو كسر فى إيصال الاستلام نفسه قبل التوقيع، فالقول الشفهى لا يُثبت شيئاً.', 'Record any scratch or damage on the delivery note itself before signing. A verbal remark proves nothing.'],
              ['استلم الفاتورة وبطاقة الضمان، وتأكد من كتابة تاريخ الشراء بشكل صحيح.', 'Take the invoice and the warranty card, and check the purchase date is written correctly.'],
              ['لا تُشغّل أى جهاز تبريد مباشرةً إذا نُقل قائماً أو مائلاً، بل اتركه قائماً فى موضعه أولاً (المتعارف عليه من ساعتين إلى ٤ ساعات، والمدة الصحيحة فى دليل الطراز).', 'Do not switch on a cooling appliance straight away if it was moved upright or tilted. Let it stand first (commonly two to four hours; the correct figure is in the model’s manual).'],
            ]),
          ],
        },
        {
          id: 'install',
          h: ['من يركّب ماذا', 'Who installs what'],
          sub: ['التوصيل والتركيب ليسا الأمر نفسه: فريق التوصيل يوصل الجهاز إلى موضعه، أما التركيب المتخصص فيقوم به فنى مؤهل وفى موعد آخر أحياناً.',
            'Delivery and installation are not the same thing: the delivery team brings the appliance to its place; specialist installation is done by a qualified technician, often on another day.'],
          blocks: [
            table(
              [['الجهاز', 'Appliance'], ['هل يحتاج تركيباً؟', 'Needs installation?'], ['من يقوم به', 'Who does it'], ['انتبه إلى', 'Watch out for']],
              [
                [['ثلاجة / فريزر', 'Fridge / freezer'], ['لا', 'No'], ['فريق التوصيل', 'The delivery team'],
                 ['اتركه قائماً قبل التشغيل كما ينص دليل الاستخدام، واترك فتحات تهوية من الخلف ومن الجانبين.', 'Let it stand before switching on as the manual says, and leave ventilation gaps behind and at the sides.']],
                [['غسالة', 'Washing machine'], ['نعم، مياه وصرف', 'Yes, water and drain'], ['فنى', 'A technician'],
                 ['فك مسامير النقل قبل أول غسلة، ومحبس مياه صالح، ونقطة صرف بارتفاع مناسب، وأرضية مستوية.', 'Remove the transit bolts before the first wash; a working water tap, a drain point at the right height, and a level floor.']],
                [['موقد غاز', 'Gas cooker'], ['نعم، وصلة غاز', 'Yes, a gas connection'], ['فنى مؤهل معتمد، وغالباً برسوم', 'A qualified approved technician, usually for a fee'],
                 ['غاز طبيعى أم أسطوانة (الفوهات تختلف)، وتهوية فى المطبخ، واختبار تسريب بالصابون أمامك.', 'Natural gas or cylinder (the jets differ), kitchen ventilation, and a soapy leak test done in front of you.']],
                [['تكييف سبليت', 'Split air conditioner'], ['نعم، تركيب متخصص', 'Yes, specialist installation'], ['فنى معتمد، وغالباً برسوم', 'An approved technician, usually for a fee'],
                 ['موضع جيد التهوية للوحدة الخارجية، ومسار للمواسير، وميل لخرطوم الصرف، والمواسير الزائدة تُحتسب.', 'A ventilated spot for the outdoor unit, a route for the pipes, a fall on the drain hose, and extra piping is charged.']],
                [['سخان غاز / كهربائى', 'Gas / electric water heater'], ['نعم', 'Yes'], ['فنى معتمد', 'An approved technician'],
                 ['تثبيت قوى، ومحبس، وصمام أمان، وتهوية لسخان الغاز، وخط كهربائى مخصص للسخان الكهربائى.', 'A strong mounting, an isolating valve, a safety valve, ventilation for gas, and a dedicated circuit for electric.']],
                [['غسالة أطباق', 'Dishwasher'], ['نعم، مياه وصرف', 'Yes, water and drain'], ['فنى', 'A technician'],
                 ['فتحة بمقاس مضبوط إن كانت مدمجة، ونقطة مياه وصرف قريبة.', 'An exact opening if it is built in, and a nearby water and drain point.']],
                [['تليفزيون', 'Television'], ['اختيارى: تثبيت على الحائط', 'Optional: wall mounting'], ['حسب الاتفاق مع البائع', 'By agreement with the seller'],
                 ['نوع الحائط والحامل، ومسار الكابلات ومقبس الكهرباء.', 'The wall type and bracket, and the route for cables and a socket.']],
              ]),
            note('warn',
              'قد يُسقط التركيبُ على يد شخص غير معتمد الضمانَ، خاصة فى التكييف والسخانات والمواقد. فاسأل عن التركيب وأنت تشترى، لا يوم التسليم، واحتفظ بإيصال التركيب.',
              'Installation by someone unauthorised can void the warranty, especially for air conditioners, water heaters and cookers. Ask about installation while you are buying, not on delivery day, and keep the installation receipt.'),
            links([['الضمان والاسترجاع', 'Warranty & returns', 'warranty.html']]),
          ],
        },
        {
          id: 'after',
          h: ['إذا تأخر الموعد أو وقعت مشكلة', 'If the appointment slips or something goes wrong'],
          blocks: [
            p('لا يوجد نظام تتبع عبر الإنترنت على هذا الموقع، ولن نعرض لك حالة شحنة غير حقيقية. وأسرع طريق هو المعرض الذى طلبت منه أو الخط الساخن ' + TEL + '، ومعك رقم الطلب أو الفاتورة.',
              'There is no online tracking system on this site and we are not going to show you a fake shipment status. The fastest route is the showroom you ordered from, or the hotline ' + TEL + ', with your order or invoice number to hand.'),
            ul([
              ['إذا تأكد الطلب وسُلّم إلى شركة شحن، فاسأل خدمة العملاء عن رقم الشحنة وطريقة تتبعها.', 'If the order has been confirmed and handed to a courier, ask customer care for the shipment number and how to track it.'],
              ['الطلبات المحفوظة على هذا الموقع مخزَّنة فى متصفحك، وتُؤكَّد بمكالمة، ولا تصل إلى أحد من تلقاء نفسها.', 'Orders saved on this site are stored in your browser and are confirmed by a phone call. They do not reach anyone on their own.'],
              ['اطلب رقماً مرجعياً واحتفظ به، واحتفظ بأى رسالة أرسلتها.', 'Ask for a reference number and keep it, along with any message you sent.'],
            ]),
            todo('لا توجد مدة تنفيذ (SLA) معتمدة منشورة للتوصيل أو التركيب فى هذه النسخة. ويُحدَّد الموعد مع المعرض أو خدمة العملاء.',
              'No approved delivery or installation lead time (SLA) is published in this preview. The appointment is agreed with the showroom or customer care.'),
            links([
              ['طلباتى', 'My orders', 'orders.html'],
              ['مركز خدمة العملاء', 'Customer care', 'care.html'],
              ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
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
          h: ['الخلاصة فى ست نقاط', 'The whole thing in six lines'],
          sub: ['تصف هذه الصفحة ما يفعله هذا الموقع فعلاً، لا ما تقوله المواقع عادةً.',
            'This page describes what this site actually does, not what sites usually say.'],
          blocks: [
            ul([
              ['إذا أنشأت حساباً: يُخزَّن الاسم والبريد الإلكترونى ورقم الهاتف وعنوان التوصيل على خادم صادكو نفسه لتتمكن من تسجيل الدخول وتقديم طلب.', 'If you create an account: your name, e-mail, phone and delivery address are stored on SADKO’s own server so you can sign in and place an order.'],
              ['أما خطط التجهيز والمنتجات المحفوظة وأجهزتك والسلة والتقييمات والأسئلة التى تكتبها فكلها فى متصفحك أنت، على جهازك، ولا تُرفع إلى أى مكان. وإذا عرّفتنا بمكانك دون إنشاء حساب، فإنه يُحفظ على جهازك أيضاً، وينتقل معك بمجرد إنشاء الحساب.', 'Shopping plans, saved products, your appliances, the cart, and the reviews and questions you write all live in your own browser on your device and are not uploaded anywhere. If you describe a place without creating an account, that also stays on your device, and moves across with you when you do create one.'],
              needs('compare', ['تجلب مقارنة الأسعار صفحات منتجات عامة من متاجر مدعومة، فهو بحث عن منتج، لا عنك أنت.', 'Price comparison fetches public product pages from supported stores: a search about a product, not about you.']),
              ['لا توجد أى بيانات بطاقات على هذا الموقع البتة: لا رقم بطاقة، ولا رمز CVV، ولا صفحة دفع.', 'No card details anywhere on this site at all: no card number, no CVV, no payment page.'],
              ['إذا سجّلت الدخول بحساب جوجل: نتلقى منهم اسمك وبريدك الإلكترونى فقط، ولا نرى كلمة مرور جوجل ولا نصل إلى أى شىء آخر فى حسابك.', 'If you sign in with Google: we receive only your name and e-mail. We never see your Google password and cannot reach anything else in your account.'],
              ['لا يوجد تتبع إعلانى ولا تحليلات من طرف ثالث على هذه الصفحات.', 'No advertising trackers and no third-party analytics on these pages.'],
              ['تُحمَّل الخطوط من Google Fonts، أى أن جوجل ترى طلب تحميل الخط (وعنوان IP الخاص به) كما فى أى موقع يستخدمها.', 'Fonts load from Google Fonts, so Google sees the font request (and its IP) as with any site that uses them.'],
            ]),
          ],
        },
        {
          id: 'account',
          h: ['الحساب: ما الذى يُخزَّن على الخادم', 'The account: what is stored on the server'],
          blocks: [
            p('يعمل نظام الحسابات فى صادكو على خادم الموقع نفسه، لا على خدمة خارجية. وهذا مقصود: فكلمة مرور مخزَّنة فى المتصفح لا تحمى شيئاً.',
              'SADKO’s account system runs on the site’s own server, not on an outside service. That is deliberate: a password kept in the browser protects nothing.'),
            defs([
              ['البيانات الأساسية', 'Core details', 'الاسم، والبريد الإلكترونى، ورقم الهاتف، وعنوان التوصيل (إن أدخلته).', 'Name, e-mail, phone number, and delivery address if you entered one.'],
              ['أماكنك (اختيارى)', 'Your places (optional)', 'يمكنك حفظ أكثر من مكان (شقة أو شاليه أو غرفة بمفردها)، ولكل منها إجابات مثل عدد الأفراد، ونوع السكن، والدور والمصعد، وعرض أضيق باب، ومقاسات الأماكن الشاغرة، ونوع الغاز، والميزانية التقريبية. وكلها اختيارية، وتُستخدم فى تصفية المنتجات وترشيحات «ساعدنى أختار» فقط.', 'You can keep several places (a flat, a chalet, or a single room), each with answers such as household size, property type, floor and lift, narrowest doorway width, the gaps appliances must fit, gas supply, and a rough budget. All optional, and used only to filter products and to shape the guided finder.'],
              ['الدخول بمزوّد خارجى', 'Provider sign-in', 'إذا استخدمت «الدخول بجوجل»، فإننا نخزّن أن هذا الحساب مرتبط بجوجل، ورقم المستخدم لديهم، وبريدك الإلكترونى المتحقق منه. ولا نخزّن أى رمز وصول من جوجل، ولا نطلب صلاحيات غير الاسم والبريد الإلكترونى.', 'If you use “Continue with Google”, we store that the account is linked to Google, your user id there, and your verified e-mail. We store no Google token and request no permission beyond name and e-mail.'],
              ['كلمة المرور', 'Password', 'لا تُخزَّن مطلقاً كنص. بل تُخزَّن على هيئة scrypt hash بملح عشوائى لكل مستخدم، وتتم المقارنة بطريقة آمنة زمنياً.', 'Never stored as text. It is stored as a scrypt hash with a per-user random salt, and comparison is timing-safe.'],
              ['الجلسة', 'The session', 'ملف تعريف ارتباط HttpOnly + SameSite (وSecure على HTTPS)، ويخزّن الخادم بصمته لا الرمز نفسه، أى أن نصوص الصفحة البرمجية لا تستطيع قراءته.', 'An HttpOnly + SameSite cookie (Secure over HTTPS); the server stores only its hash, not the token itself, so page scripts cannot read it.'],
              ['الطلبات', 'Orders', 'إذا قدّمت طلباً: المنتجات، وبيانات التوصيل، وطريقة دفع بدون بطاقات. وتظل رسوم التوصيل والتركيب فارغة إلى أن تؤكدها خدمة العملاء.', 'If you place an order: the items, the delivery details, and a non-card payment method. Delivery and installation fees stay blank until customer care confirms them.'],
            ]),
            note('info',
              'فى هذه النسخة التجريبية تعمل معظم الصفحات دون تسجيل دخول أصلاً، أى أنك إن لم تُنشئ حساباً، فلا توجد بيانات شخصية لك على أى خادم لهذا الموقع.',
              'In this preview most pages work without signing in at all, so if you do not create an account, this site holds no personal data of yours on any server.'),
            todo('مدة الاحتفاظ بالبيانات، والمسؤول عن حماية البيانات فى صادكو، وإجراء طلب نسخة من بياناتك: كلها تحتاج اعتماداً رسمياً من الشركة قبل أن تُكتب هنا التزاماً.',
              'The data-retention period, SADKO’s data-protection contact, and the procedure for requesting a copy of your data all need formal company sign-off before being written here as a commitment.'),
          ],
        },
        {
          id: 'local',
          h: ['ما هو مخزَّن فى متصفحك أنت', 'What is stored in your own browser'],
          sub: ['تُحفظ هذه العناصر فى localStorage على جهازك. ولا تُرفع، ولا تراها صادكو، وتُمحى إذا مسحت بيانات المتصفح.',
            'These live in localStorage on your device. They are not uploaded, SADKO cannot see them, and they disappear if you clear your browser data.'],
          blocks: [
            table(
              [['المفتاح', 'Key'], ['ما يحتويه', 'What it holds']],
              [
                [['sadko-cart-v1', 'sadko-cart-v1'], ['سلة التسوق: المنتجات التى أضفتها والكميات.', 'The shopping cart: the products you added and their quantities.']],
                [['sadko-saved-v1', 'sadko-saved-v1'], ['المنتجات المحفوظة والسعر وقت الحفظ لنعرض لك التغيّر.', 'Saved products and the price at the time you saved them, so we can show the change.']],
                [['sadko-plans-v1', 'sadko-plans-v1'], ['خطط التجهيز: الأجهزة والميزانية والملاحظات.', 'Shopping plans: appliances, budget and notes.']],
                needs('appliances', [['sadko-owned-v1', 'sadko-owned-v1'], ['أجهزتك المسجَّلة: الطراز، والرقم التسلسلى، وتاريخ الشراء، ومدة الضمان.', 'Your recorded appliances: model, serial, purchase date and warranty length.']]),
                [['sadko-profile-v1', 'sadko-profile-v1'], ['إجابات ملف المنزل إن أجبت عنها دون حساب.', 'Home-profile answers if you filled them in without an account.']],
                [['sadko-qa-v1 / sadko-reviews-v1', 'sadko-qa-v1 / sadko-reviews-v1'], ['الأسئلة والتقييمات التى تكتبها، تُحفظ محلياً ولا تُنشر لأحد.', 'The questions and reviews you write, kept locally and not published to anyone.']],
                [['sadko-lang', 'sadko-lang'], ['لغة العرض: العربية أم الإنجليزية.', 'The display language: Arabic or English.']],
                [['sadko-guide-v1 / sadko-hs-coach-v1', 'sadko-guide-v1 / sadko-hs-coach-v1'], ['علامة تفيد أنك شاهدت جولة التعريف فى الصفحة الرئيسية، حتى لا تتكرر.', 'A flag that you have seen the home-page walkthrough, so it does not repeat.']],
              ]),
            note('warn',
              'ولأن هذا تخزين محلى: إذا مسحت بيانات المتصفح، أو فتحت الموقع من جهاز آخر أو من نافذة تصفح خفى، فلن تجد هذه العناصر. ولا توجد مزامنة بين الأجهزة.',
              'Because this is local storage: if you clear browser data, or open the site on another device or in a private window, none of it will be there. There is no sync between devices.'),
          ],
        },
        needs('compare', {
          id: 'compare',
          h: ['مقارنة الأسعار', 'Price comparison'],
          blocks: [
            p('عند إجراء مقارنة، يُرسَل اسم المنتج الذى تبحث عنه إلى خادم الموقع، فيجلب الخادم صفحات المنتجات العامة من قائمة متاجر مدعومة ويقرأ منها السعر والعنوان. وهذا بحث عن منتج، لا يُرسَل معه اسمك ولا هاتفك ولا سلتك.',
              'When you run a comparison, the product name you are searching for is sent to the site’s server, and the server fetches public product pages from a list of supported stores and reads the price and title from them. That is a product search: your name, phone and cart are not sent with it.'),
            ul([
              ['ترى المتاجر المدعومة طلب زيارة لصفحاتها العامة، مثل أى زيارة عادية للصفحة.', 'Supported stores see a request for their public pages, like any ordinary page visit.'],
              ['وإذا ضغطت على عرض من متجر آخر وانتقلت إلى موقعه، فقد صرت على موقعه هو وسياسة الخصوصية الخاصة به هى التى تسرى.', 'If you click an offer from another store and leave, you are on their site and their privacy policy applies.'],
              ['تُعرض نتائج المقارنة فى الصفحة، ولا تُضاف إلى أى ملف شخصى.', 'Comparison results are shown on the page and are not attached to any profile.'],
            ]),
            links([['مقارنة الأسعار', 'Price comparison', 'compare.html'], ['شروط الاستخدام', 'Terms of use', 'terms.html']]),
          ],
        }),
        {
          id: 'payments',
          h: ['بيانات الدفع', 'Payment details'],
          blocks: [
            note('info',
              'لا نجمع ولا نخزّن ولا نمرّر أى بيانات بطاقات على هذا الموقع. ولا توجد صفحة دفع ولا خانة رقم بطاقة ولا رمز CVV فى أى مكان. وتُؤكَّد الطلبات بمكالمة، ويتم الدفع مع البائع بالطرق التى يحددها لك (مثل الدفع عند الاستلام أو فى المعرض).',
              'We do not collect, store or pass on any card details on this site. There is no payment page, no card-number field and no CVV anywhere. Orders are confirmed by phone, and payment happens with the seller by the methods they tell you (such as cash on delivery or in the showroom).'),
            p('وإذا طلبت منك أى صفحة على هذا الموقع بيانات بطاقة، فهى ليست صفحة تخصنا. لا تُدخلها واتصل بنا على ' + TEL + '.',
              'If any page on this site ever asks you for card details, it is not ours. Do not enter them, and call us on ' + TEL + '.'),
          ],
        },
        {
          id: 'third',
          h: ['التتبع والأطراف الأخرى', 'Tracking and third parties'],
          blocks: [
            ul([
              ['لا توجد تحليلات من طرف ثالث ولا بكسل إعلانى ولا ملفات تعريف ارتباط للتتبع على هذه الصفحات.', 'No third-party analytics, advertising pixels or tracking cookies on these pages.'],
              ['يُحمَّل خط (Cairo) من fonts.googleapis.com و fonts.gstatic.com. وترى جوجل طلب الخط وعنوان IP الذى طلبه. وإذا كان ذلك يهمك، فأدوات حجب الطلبات الخارجية توقفه ويظل الموقع يعمل بخط بديل.', 'The Cairo font loads from fonts.googleapis.com and fonts.gstatic.com. Google sees the font request and the IP that made it. If that matters to you, a blocker will stop it and the site still works with a fallback font.'],
              ['قد تُحمَّل صور المنتجات من الخوادم نفسها التى قُرئ منها الكتالوج.', 'Product images may load from the same servers the catalogue was read from.'],
              ['روابط مثل موقع شركة الشحن أو مواقع المتاجر الأخرى تنقلك إلى مواقع لا صلة لنا بها، وتخضع لسياساتها هى.', 'Links such as a courier’s site or other stores take you to sites unrelated to us, under their own policies.'],
            ]),
          ],
        },
        {
          id: 'delete',
          h: ['كيف تمحو بياناتك', 'How to delete your data'],
          blocks: [
            ol([
              ['العناصر المحلية (السلة، والمحفوظات، والخطط، وأجهزتك، والتقييمات): امسح بيانات الموقع من إعدادات المتصفح: Clear site data لنطاق هذا الموقع. وهذا يمحوها فوراً وبالكامل.', 'Local items (cart, saved products, plans, appliances, reviews): clear site data for this site’s domain from your browser settings. That removes them immediately and completely.'],
              ['ولكل صفحة تحتوى بيانات محفوظة زر مسح خاص بها أيضاً (احذف الخطة، أزل الجهاز، أفرغ السلة).', 'Each page that holds saved data also has its own delete control (delete the plan, remove the appliance, empty the cart).'],
              ['الحساب على الخادم (إن كنت قد أنشأت واحداً): اطلب حذفه من خدمة العملاء على ' + TEL + ' أو ' + MAIL + '، مع ذكر البريد الإلكترونى المسجَّل به.', 'The server account (if you created one): ask customer care to delete it on ' + TEL + ' or ' + MAIL + ', quoting the registered e-mail.'],
            ]),
            todo('تحتاج مدة تنفيذ طلب الحذف وإجراءات التحقق من هوية صاحب الطلب إلى اعتماد من صادكو، وهما غير منشورين بعد.',
              'The turnaround for a deletion request and the identity checks around it need SADKO sign-off. They are not published yet.'),
            links([['مركز خدمة العملاء', 'Customer care', 'care.html'], ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL]]),
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
            p('هذا الموقع نسخة معاد تصميمها (Rebrand Preview) لصادكو جروب، تعرض كتالوج منتجات وأدوات تساعدك على الاختيار: ترشيحات، ' + (window.skFeature && !window.skFeature.on('compare') ? '' : 'ومقارنة أسعار، ') + 'وأدلة شراء، وخطط تجهيز. واستخدامك للموقع يعنى موافقتك على الإرشادات المكتوبة هنا.',
              'This site is a rebrand preview for SADKO Group. It presents a product catalogue and tools that help you choose: recommendations, ' + (window.skFeature && !window.skFeature.on('compare') ? '' : 'price comparison, ') + 'buying guides and shopping plans. Using the site means you accept the guidance set out here.'),
            ul([
              ['استخدم الموقع للأغراض الشخصية والمشروعة فقط.', 'Use the site for personal, lawful purposes only.'],
              ['لا تحاول سحب الكتالوج آلياً، أو إثقال الخادم بطلبات كثيرة، أو تعطيل الخدمة.', 'Do not scrape the catalogue automatically, overload the server with requests, or disrupt the service.'],
              ['ما تكتبه من محتوى (تقييم أو سؤال) يجب أن يخلو من الإساءة، وهو محفوظ فى متصفحك أنت أصلاً.', 'Anything you write (a review or a question) must be free of abuse, and it is kept in your own browser anyway.'],
            ]),
          ],
        },
        {
          id: 'prices',
          h: ['الأسعار والتوافر', 'Prices and availability'],
          blocks: [
            p('الأسعار المعروضة مأخوذة من صفحات المنتجات وقت آخر تحديث للكتالوج، وقد تكون تغيّرت منذ ذلك الحين. وعرض السعر هنا ليس إيجاباً ملزماً بالبيع، والسعر النهائى هو الذى يُؤكَّد فى المعرض أو من خدمة العملاء وقت الطلب.',
              'Prices shown are taken from product pages at the time of the catalogue’s last update and may have changed since. A price here is not a binding offer; the final price is the one confirmed in the showroom or by customer care when you order.'),
            ul([
              ['يتغيّر التوافر بسرعة، فاسأل قبل التوجه إلى المعرض.', 'Availability changes quickly. Ask before travelling to a showroom.'],
              ['الصور استرشادية، وقد يختلف اللون أو الملحقات بحسب الطراز.', 'Images are indicative; colour or accessories may differ by model.'],
              ['رسوم التوصيل والتركيب غير داخلة فى السعر المعروض إلا إذا نص وصف المنتج على ذلك صراحةً.', 'Delivery and installation fees are not included in the shown price unless the product description says so explicitly.'],
            ]),
            links([['التوصيل والتركيب', 'Delivery & installation', 'delivery.html']]),
          ],
        },
        {
          id: 'specs',
          h: ['المواصفات مقروءة آلياً، وهذا يعنى وجود ثغرات', 'Specifications are read automatically, which means there are gaps'],
          blocks: [
            p('المواصفات التى تراها فى الجداول والمقارنات (السعة، والمقاسات، وكفاءة الطاقة، واللون، والخصائص) مستخرجة آلياً من عناوين المنتجات وأوصافها. وحين لا يذكر الوصف شيئاً، تظهر «غير متوفر»، ومعناها أننا لا نعلم، لا أن الجهاز يفتقر إلى تلك الخاصية.',
              // Quotes the label the English UI actually shows ("not stated", see
              // product.js), not the Arabic one: quoting «غير متوفر» here put Arabic
              // in the middle of an English paragraph AND named a label an English
              // reader would never see on screen.
              'The specifications you see in tables and comparisons (capacity, dimensions, energy rating, colour, features) are extracted automatically from product titles and descriptions. When a description does not mention something it shows as "not stated", which means we do not know, not that the appliance lacks it.'),
            note('warn',
              'قبل الشراء بناءً على رقم بعينه (مقاس، أو سعة، أو كفاءة طاقة، أو مدة ضمان)، أكّده من صفحة المنتج الأصلية أو من خدمة العملاء على ' + TEL + '. فالقراءة الآلية قد تُخطئ.',
              'Before you buy on the strength of a particular figure (a dimension, a capacity, an energy rating, a warranty period), confirm it against the original product page or with customer care on ' + TEL + '. Automatic reading can get it wrong.'),
          ],
        },
        needs('compare', {
          id: 'compare',
          h: ['مقارنة الأسعار', 'Price comparison'],
          blocks: [
            ul([
              ['تغطى المقارنة قائمة محددة من المتاجر المدعومة، لا كل المتاجر فى مصر، أى أنه قد يوجد سعر أفضل فى مكان غير مشمول.', 'Comparison covers a specific list of supported stores, not every store in Egypt. There may be a better price somewhere not covered.'],
              ['تُجمَع النتائج لحظياً من صفحات عامة، وقد تكون ناقصة أو متأخرة إذا غيّر المتجر شكل صفحاته أو كان غير متاح.', 'Results are gathered live from public pages and can be incomplete or stale if a store changes its page layout or is unavailable.'],
              ['مطابقة المنتجات تقريبية: فقد يظهر طرازان متقاربان معاً، فراجع الطراز بدقة قبل مقارنة السعر.', 'Product matching is approximate: two similar models can appear side by side, so check the exact model before comparing price.'],
              ['أى شراء من متجر آخر يتم بينك وبينه هو. والضمان والتوصيل والاسترجاع والفاتورة كلها تخصه، وصادكو ليست طرفاً فى العملية.', 'Any purchase from another store is between you and them. Warranty, delivery, returns and the invoice are all theirs, and SADKO is not a party to it.'],
            ]),
            links([['الضمان والاسترجاع', 'Warranty & returns', 'warranty.html'], ['مقارنة الأسعار', 'Price comparison', 'compare.html']]),
          ],
        }),
        {
          id: 'advice',
          h: ['الترشيحات والأدلة إرشادية', 'Recommendations and guides are guidance'],
          blocks: [
            p('ترشّح أداة «ساعدنى أختار» بناءً على إجاباتك وعلى بيانات الكتالوج، وتذكر لك سبب كل ترشيح. وهو رأى استرشادى يساعدك على تضييق الاختيارات، لا استشارة هندسية ولا كهربائية ولا تقديراً رسمياً لاحتياجك.',
              'The guided finder recommends based on your answers and the catalogue data, and writes out the reason for each suggestion. That is guidance to narrow your options, not engineering or electrical advice, and not a formal assessment of your needs.'),
            ul([
              ['أرقام المساحات والسعات فى الأدلة قواعد تقريبية شائعة، والرقم الملزم هو الوارد فى دليل الطراز.', 'The area and capacity figures in the guides are common rules of thumb; the binding number is in the model’s manual.'],
              ['أعمال الغاز والكهرباء والتركيب يجب أن يقوم بها فنى مؤهل، والأدلة تدلك على ما تسأل عنه، لا على أن تؤديه بنفسك.', 'Gas, electrical and installation work must be done by a qualified technician. The guides tell you what to ask about, not how to do it yourself.'],
            ]),
            links([['ساعدنى أختار', 'Help me choose', 'finder.html'], ['دليلك للاختيار', 'Buying guides', 'guides.html']]),
          ],
        },
        {
          id: 'orders',
          h: ['الطلبات والإلغاء', 'Orders and cancellation'],
          blocks: [
            p('السلة والطلبات المحفوظة على هذا الموقع وسيلة تنظيم: تجمع ما تريده وتجهّزه فى صيغة ترسلها أو تقرؤها فى مكالمة. ولا يتحول الطلب إلى عقد بيع إلا حين يُؤكَّد مع صادكو (بمكالمة على ' + TEL + ' أو فى المعرض).',
              'The cart and saved orders on this site are an organising tool: they gather what you want and put it in a form you can send or read out on a call. An order does not become a contract of sale until it is confirmed with SADKO (by a call on ' + TEL + ' or in a showroom).'),
            ul([
              ['تُؤكَّد رسوم التوصيل والتركيب قبل التنفيذ، ولا تُحتسب تلقائياً على الموقع.', 'Delivery and installation fees are confirmed before the work and are not calculated automatically on the site.'],
              ['يتم الإلغاء أو التعديل قبل التنفيذ بمكالمة على ' + TEL + '، فى أقرب وقت ممكن، خاصةً إذا كان قد حُدِّد للجهاز موعد تركيب.', 'Cancelling or amending before fulfilment is done by calling ' + TEL + ', as early as you can, especially once an installation slot is booked.'],
              ['أما الإلغاء بعد التسليم أو بعد التركيب فيحكمه شرط الاسترجاع لدى البائع.', 'Cancelling after delivery or after installation is governed by the seller’s return conditions.'],
            ]),
            todo('تحتاج شروط الإلغاء والاسترجاع الرسمية، وأى رسوم مرتبطة بها، إلى اعتماد من صادكو. وإلى أن تُنشر، اسأل خدمة العملاء قبل الشراء.',
              'The formal cancellation and return conditions, and any fees attached to them, need SADKO sign-off. Until they are published, ask customer care before buying.'),
            links([['طلباتى', 'My orders', 'orders.html'], ['مركز خدمة العملاء', 'Customer care', 'care.html']]),
          ],
        },
        {
          id: 'ip',
          h: ['الملكية الفكرية', 'Intellectual property'],
          blocks: [
            ul([
              ['تصميم الموقع ونصوصه وأدلته من إنتاج صادكو جروب، ولا يُسمح بإعادة نشرها تجارياً دون إذن.', 'The site’s design, its text and its guides are produced by SADKO Group and may not be republished commercially without permission.'],
              ['أسماء العلامات التجارية وشعاراتها ملك أصحابها، وذكرها هنا للتعريف بالمنتجات فقط.', 'Brand names and logos belong to their owners and are used here only to identify products.'],
              ['صور وأوصاف المنتجات مصدرها صفحات المنتجات نفسها وحقوقها لأصحابها.', 'Product images and descriptions come from the product pages themselves and their rights belong to their owners.'],
              ['وإذا رأيت محتوى منشوراً هنا بالخطأ أو مخالفاً لحقك، فاتصل بنا على ' + MAIL + ' وسنصححه.', 'If you believe content here is published in error or infringes your rights, contact us on ' + MAIL + ' and we will fix it.'],
            ]),
          ],
        },
        {
          id: 'changes',
          h: ['تعديل الشروط والتواصل', 'Changes and contact'],
          blocks: [
            p('قد تُعدَّل هذه الصفحة مع تطور الموقع، وتاريخ آخر تحديث مذكور أعلاه. وإذا وقع تعارض بين ما هو مكتوب هنا وبين فاتورتك أو بطاقة الضمان أو سياسة البائع، فالفاتورة وبطاقة الضمان وسياسة البائع هى التى تسرى.',
              'This page may change as the site develops; the last-updated date is shown above. If anything here conflicts with your invoice, your warranty card or the seller’s policy, the invoice, the card and the seller’s policy prevail.'),
            todo('البيانات القانونية للشركة (السجل التجارى، والبطاقة الضريبية، والعنوان المسجَّل) والصياغة القانونية النهائية للشروط غير مكتوبة هنا عن قصد، لأنها يجب أن ترد من صادكو نفسها موثَّقة، لا أن تُؤلَّف.',
              'The company’s legal identifiers (commercial register, tax card, registered address) and the final legal wording of these terms are deliberately not written here. They must come from SADKO itself, verified, not invented.'),
            links([
              ['اتصل على ' + TEL, 'Call ' + TEL, 'tel:' + TEL],
              ['أرسل بريداً إلكترونياً', 'Send an e-mail', 'mailto:' + MAIL],
              ['المعارض', 'Showrooms', 'showrooms.html'],
            ]),
          ],
        },
      ],
    },
  };

  /* ================= page chrome ================= */

  function topBlock(key, page) {
    const toc = page.sections.filter(shown).map(s =>
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
      '<div class="doc">' + s.blocks.filter(shown).map(block).join('') + '</div>' +
      '</section>';
  }

  function crossLinks(key) {
    const items = Object.keys(XLINKS).filter(k => k !== key).map(k => XLINKS[k]);
    items.push(['مركز خدمة العملاء', 'Customer care', 'care.html']);
    items.push(['دليلك للاختيار', 'Buying guides', 'guides.html']);
    items.push(['المعارض', 'Showrooms', 'showrooms.html']);
    return '<section class="panel info-x">' +
      '<h2 class="panel__h">' + E(t('صفحات أخرى قد تهمك', 'Other pages you may need')) + '</h2>' +
      '<p class="panel__sub">' + E(t('صفحات المعلومات الأربع يكمّل بعضها بعضاً، وخدمة العملاء على ' + TEL + ' هى المرجع فى تأكيد أى تفصيلة.',
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
        E(t('هذه الصفحة غير موجودة.', 'This page does not exist.')) + '</p></div>';
      return;
    }
    injectCSS();
    root.innerHTML =
      topBlock(key, page) +
      page.sections.filter(shown).map(s => section(key, s)).join('') +
      crossLinks(key);
  }

  window.mountInfo = mountInfo;
})();
