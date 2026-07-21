/* ============================================================================
   Home Experience — compose a room of appliances to try, then book a showroom
   visit. Arabic-first (RTL) with English mode, matching the SADKO design system.
   Reads products from data/products.json; branches + slots + booking from the
   /api/experience/* endpoints. The "experience list" (devices to try) is kept
   in localStorage, separate from the shopping cart.
   ========================================================================== */
(function () {
  'use strict';
  var LANG = (window.skLang && window.skLang.get()) || 'ar';
  var EN = LANG === 'en';
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return Number(n || 0).toLocaleString('en-US'); };

  /* ---------------- i18n ---------------- */
  var T = {
    ar: {
      title: 'تجربة البيت — صادكو جروب',
      crumbHome: 'البيت', crumbHere: 'تجربة البيت',
      heroTitle: 'عيش الجهاز قبل ما تشتريه',
      heroLead: 'اختَر الأجهزة اللى نفسك تجرّبها، ابنى غرفتك، واحجز زيارة لأقرب معرض صادكو. هناك تلاقى غرفة زى بيتك بالظبط — الأجهزة شغّالة، مرشد خبير يشرح ويقارن لك، وحتى وجبة بسيطة تطلعها من الثلاجة وتسخّنها فى الميكروويف. تحس بالجهاز بجد قبل القرار.',
      perk1: 'أجهزة شغّالة تجرّبها بنفسك', perk2: 'غرفة محاكاة زى بيتك',
      perk3: 'مرشد خبير يقارن ويشرح', perk4: 'وجبة تجريبية على الطبيعة',
      step1: 'ابنى غرفتك', step2: 'المعرض', step3: 'الميعاد', step4: 'بياناتك', step5: 'التأكيد',
      s1h: 'ابنى غرفتك', s1sub: 'اختَر الأجهزة اللى نفسك تعيشها على الطبيعة. تقدر تضيف أكتر من موديل وأكتر من نوع — حتى لو عايز تقارن كذا ميكروويف جنب بعض.',
      s1next: 'التالى: اختَر المعرض', s1hint: 'ضيف جهاز واحد على الأقل عشان تكمّل.',
      all: 'كل الأجهزة', add: 'ضيف للتجربة', added: 'اتضاف ✓', pcount: function (n) { return n + ' جهاز'; },
      emptyCat: 'مفيش أجهزة فى القسم ده دلوقتى.',
      trayTitle: 'غرفتك', trayCount: function (n) { return n === 0 ? 'لسه فاضية' : (n + ' جهاز للتجربة'); },
      trayEmpty: 'اختَر أجهزة من على الشمال وهتظهر هنا كأنها فى غرفتك.',
      egp: 'ج.م', remove: 'شيل',
      compareHint: function (cat) { return 'اخترت أكتر من ' + cat + ' — فى المعرض هنركّبهم جنب بعض وتقارن بينهم على الطبيعة. أو '; },
      compareLink: 'قارن أسعارهم دلوقتى',
      perkTry: 'كل جهاز هيكون شغّال وتقدر تجرّبه', perkGuide: 'مرشد خبير معاك طول الزيارة', perkMeal: 'وجبة تجريبية من الثلاجة للميكروويف',
      s2h: 'اختَر المعرض', s2sub: 'اختَر أقرب معرض ليك — هناك هنجهّز لك الغرفة بالأجهزة اللى اخترتها.',
      s2next: 'التالى: الميعاد', pick: 'مختار ✓',
      seasonNote: 'معرض مارينا بيشتغل فى موسم الصيف بس — لو خارج الموسم اختَر معرض تانى.',
      s3h: 'اختَر اليوم والميعاد', s3sub: 'اختَر اليوم اللى يناسبك، وبعدين ميعاد من المواعيد المتاحة.',
      s3slots: 'المواعيد المتاحة', s3next: 'التالى: بياناتك', noSlots: 'مفيش مواعيد متاحة فى اليوم ده — جرّب يوم تانى.', slotsLoading: 'بنجيب المواعيد…',
      s4h: 'بياناتك', s4sub: 'هنكلّمك على الرقم ده عشان نأكّد ميعاد الزيارة.',
      fName: 'الاسم', fNamePh: 'اكتب اسمك', errName: 'اكتب اسمك من فضلك.',
      fPhone: 'رقم الموبايل', fPhonePh: '01xxxxxxxxx', errPhone: 'اكتب رقم موبايل مصرى صحيح.',
      fNotes: 'ملاحظات (اختيارى)', fNotesPh: 'أى تفاصيل تحب نعرفها قبل الزيارة',
      s4next: 'التالى: المراجعة', back: 'رجوع',
      s5h: 'مراجعة وتأكيد', s5sub: 'راجع تفاصيل تجربتك، ولو كله تمام أكّد الحجز.',
      s5confirm: 'أكّد الحجز', rDevices: 'الأجهزة', rBranch: 'المعرض', rWhen: 'الميعاد', rYou: 'بياناتك', edit: 'تعديل',
      booking: 'بنأكّد الحجز…',
      doneTitle: 'تم حجز تجربتك 🎉',
      doneLead: 'استلمنا طلبك وهنكلّمك قريب على الرقم اللى كتبته عشان نأكّد ميعاد الزيارة ونجهّز غرفتك.',
      refLabel: 'رقم الحجز',
      callout: '📞 هيوصلك اتصال من فريق صادكو خلال يوم عمل لتأكيد الميعاد. احتفظ برقم الحجز.',
      bookAnother: 'احجز تجربة تانية', goShop: 'روح للمتجر',
      errGeneric: 'حصلت مشكلة — جرّب تانى.',
      errSlotFull: 'الميعاد ده اتحجز خلاص — اختَر ميعاد تانى.',
      hotline: 'الخط الساخن', copy: '© صادكو جروب 2026 — نسخة معاد تصميمها (Rebrand Preview)',
      dow: ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'],
      mon: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    },
    en: {
      title: 'Home Experience — SADKO Group',
      crumbHome: 'Home', crumbHere: 'Home Experience',
      heroTitle: 'Live with the appliance before you buy it',
      heroLead: 'Pick the appliances you want to try, build your room, and book a visit to your nearest SADKO showroom. There you’ll find a room set up just like your home — the appliances running, an expert guide who explains and compares for you, and even a simple meal you take from the fridge and heat in the microwave. Really feel the appliance before you decide.',
      perk1: 'Appliances running — try them yourself', perk2: 'A simulated room like your home',
      perk3: 'An expert guide who compares & explains', perk4: 'A hands-on meal demo',
      step1: 'Build room', step2: 'Showroom', step3: 'Time', step4: 'Your details', step5: 'Confirm',
      s1h: 'Build your room', s1sub: 'Pick the appliances you want to experience for real. Add as many models and types as you like — even several microwaves to compare side by side.',
      s1next: 'Next: choose showroom', s1hint: 'Add at least one appliance to continue.',
      all: 'All appliances', add: 'Add to try', added: 'Added ✓', pcount: function (n) { return n + ' appliance' + (n === 1 ? '' : 's'); },
      emptyCat: 'No appliances in this category right now.',
      trayTitle: 'Your room', trayCount: function (n) { return n === 0 ? 'still empty' : (n + ' appliance' + (n === 1 ? '' : 's') + ' to try'); },
      trayEmpty: 'Pick appliances on the left and they’ll appear here, as if in your room.',
      egp: 'EGP', remove: 'remove',
      compareHint: function (cat) { return 'You picked more than one ' + cat + ' — at the showroom we’ll set them side by side to compare for real. Or '; },
      compareLink: 'compare their prices now',
      perkTry: 'Every appliance running, ready to try', perkGuide: 'An expert guide with you throughout', perkMeal: 'A meal demo from fridge to microwave',
      s2h: 'Choose a showroom', s2sub: 'Pick the branch nearest you — we’ll set up the room there with the appliances you chose.',
      s2next: 'Next: pick a time', pick: 'Selected ✓',
      seasonNote: 'The Marina showroom is open in summer only — off-season, please choose another branch.',
      s3h: 'Pick a day and time', s3sub: 'Choose a day that suits you, then an available time slot.',
      s3slots: 'Available times', s3next: 'Next: your details', noSlots: 'No slots available that day — try another.', slotsLoading: 'Loading times…',
      s4h: 'Your details', s4sub: 'We’ll call you on this number to confirm the visit.',
      fName: 'Name', fNamePh: 'Your name', errName: 'Please enter your name.',
      fPhone: 'Mobile number', fPhonePh: '01xxxxxxxxx', errPhone: 'Enter a valid Egyptian phone number.',
      fNotes: 'Notes (optional)', fNotesPh: 'Anything we should know before your visit',
      s4next: 'Next: review', back: 'Back',
      s5h: 'Review & confirm', s5sub: 'Check your experience details, then confirm the booking.',
      s5confirm: 'Confirm booking', rDevices: 'Appliances', rBranch: 'Showroom', rWhen: 'Time', rYou: 'Your details', edit: 'Edit',
      booking: 'Confirming…',
      doneTitle: 'Your experience is booked 🎉',
      doneLead: 'We’ve got your request and will call you soon on the number you gave to confirm the visit and set up your room.',
      refLabel: 'Booking reference',
      callout: '📞 A SADKO team member will call within one business day to confirm. Keep your booking reference.',
      bookAnother: 'Book another experience', goShop: 'Go to the shop',
      errGeneric: 'Something went wrong — please try again.',
      errSlotFull: 'That slot was just taken — please pick another.',
      hotline: 'Hotline', copy: '© SADKO Group 2026 — Rebrand Preview',
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    },
  }[LANG];

  /* apply static translations + direction */
  if (EN) { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; document.title = T.title; }
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var k = el.getAttribute('data-i18n'); if (typeof T[k] === 'string') el.textContent = T[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
    var k = el.getAttribute('data-i18n-ph'); if (typeof T[k] === 'string') el.placeholder = T[k];
  });

  var trTitle = function (s) {
    return (EN && window.skCatalogI18n) ? window.skCatalogI18n.translateTitle(s) : String(s || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  };
  var catEn = window.skCatEn || {};
  var catName = function (n) { return EN ? (catEn[n] || n) : n; };

  /* ---------------- category taxonomy (mirrors nav.js SHOP_TREE) ---------------- */
  var TREE = [
    { id: '38003882', name: 'ثلاجات', kids: [['38022268', 'نو فروست'], ['38022269', 'ديفروست']] },
    { id: '38005648', name: 'فريزرات', kids: [['38022353', 'فريزر أفقى'], ['38005649', 'فريزر رأسى']] },
    { id: '38003799', name: 'أفران وبوتاجازات', kids: [['50846528', '4 شعلة'], ['50844229', '5 شعلة'], ['38022202', 'أفران كهربائية']] },
    { id: '38005652', name: 'غسالات', kids: [['38003963', 'غسالات ملابس'], ['38022354', 'غسالات أطباق']] },
    { id: '40507239', name: 'سخانات مياه', kids: [['48149056', 'سخانات كهرباء'], ['48143206', 'سخانات غاز']] },
    { id: '112439376', name: 'أجهزة صغيرة', kids: [['81170222', 'مكانس'], ['81167227', 'مكاوى'], ['68782006', 'خلاطات ومحضرات طعام'], ['57646037', 'ميكروييف'], ['185355010', 'كاتيل وماكينات قهوة'], ['185364502', 'قلايات']] },
    { id: '38032005', name: 'تكييفات هواء' },
    { id: '38022381', name: 'تليفزيونات' },
    { id: '50318054', name: 'مبردات هواء ومراوح' },
    { id: '102858075', name: 'مبردات مياه' },
    { id: '173607281', name: 'عروض صادكو' },
    { id: '195273251', name: 'الأكثر مبيعاً' },
  ];
  var idsUnder = function (t) { return [t.id].concat((t.kids || []).map(function (k) { return k[0]; })); };

  /* ---------------- state ---------------- */
  var KEY = 'sadko-experience-v1';
  var readList = function () { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  var writeList = function (a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} };

  var st = {
    step: 1, maxReached: 1,
    products: [], cat: TREE[0].id, sub: null,
    list: readList(),
    branches: [], branch: null,
    date: null, time: null,
    name: '', phone: '', notes: '',
  };

  /* ---------------- stepper rail ---------------- */
  var STEPS = [T.step1, T.step2, T.step3, T.step4, T.step5];
  function renderRail() {
    $('hxRail').innerHTML = STEPS.map(function (label, i) {
      var n = i + 1;
      var cls = n < st.step ? 'done' : n === st.step ? 'active' : (n <= st.maxReached ? 'reach' : '');
      return '<li class="' + cls + '"><button data-goto="' + n + '">' +
        '<span class="hx-rail__n">' + (n < st.step ? '✓' : n) + '</span>' +
        '<span class="hx-rail__t">' + label + '</span></button></li>';
    }).join('');
  }
  function show(n) {
    if (n > 6) n = 6;
    st.step = n; st.maxReached = Math.max(st.maxReached, n);
    document.querySelectorAll('.hx-step').forEach(function (s) {
      s.classList.toggle('is-on', +s.getAttribute('data-step') === n);
    });
    renderRail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (n === 5) renderReview();
  }

  /* ---------------- STEP 1: build your room ---------------- */
  function renderCats() {
    $('hxCats').innerHTML = TREE.map(function (t) {
      return '<button class="hx-cat' + (t.id === st.cat ? ' on' : '') + '" data-cat="' + t.id + '">' + catName(t.name) + '</button>';
    }).join('');
    var t = TREE.find(function (x) { return x.id === st.cat; });
    $('hxSubs').innerHTML = (t && t.kids) ? t.kids.map(function (k) {
      return '<button class="hx-sub-pill' + (k[0] === st.sub ? ' on' : '') + '" data-sub="' + k[0] + '">' + catName(k[1]) + '</button>';
    }).join('') : '';
  }
  function visibleProducts() {
    var t = TREE.find(function (x) { return x.id === st.cat; });
    if (!t) return [];
    var ids = st.sub ? [st.sub] : idsUnder(t);
    return st.products.filter(function (p) { return ids.indexOf(String(p.categoryId)) !== -1; });
  }
  function renderGrid() {
    var ps = visibleProducts();
    $('hxCount').textContent = T.pcount(ps.length);
    if (!ps.length) { $('hxGrid').innerHTML = '<p class="hx-empty">' + T.emptyCat + '</p>'; return; }
    var picked = {}; st.list.forEach(function (i) { picked[i.id] = 1; });
    $('hxGrid').innerHTML = ps.slice(0, 60).map(function (p) {
      var on = picked[p.id];
      return '<div class="hx-pc' + (on ? ' picked' : '') + '">' +
        '<div class="hx-pc__img">' + (p.image ? '<img loading="lazy" src="' + p.image + '" alt="">' : '<span class="hx-pc__noimg">?</span>') + '</div>' +
        '<div class="hx-pc__b">' +
          '<div class="hx-pc__t">' + esc(trTitle(p.title)) + '</div>' +
          '<div class="hx-pc__p">' + money(p.price) + ' <small>' + T.egp + '</small></div>' +
          '<button class="hx-pc__add" data-add="' + p.id + '">' + (on ? T.added : T.add) + '</button>' +
        '</div></div>';
    }).join('');
  }
  function currentCatName() {
    var t = TREE.find(function (x) { return x.id === st.cat; });
    return t ? catName(t.name) : '';
  }
  function addDevice(id) {
    var p = st.products.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    if (st.list.some(function (i) { return i.id === p.id; })) return;
    var t = TREE.find(function (x) { return idsUnder(x).indexOf(String(p.categoryId)) !== -1; });
    st.list.push({ id: p.id, title: p.title, image: p.image, price: p.price,
      category: t ? t.name : '', categoryId: t ? t.id : '' });
    writeList(st.list); toast(T.added);
    renderGrid(); renderTray();
  }
  function removeDevice(id) {
    st.list = st.list.filter(function (i) { return i.id !== id; });
    writeList(st.list); renderGrid(); renderTray();
  }
  function renderTray() {
    var n = st.list.length;
    var head = '<div class="hx-tray__head"><h3>' + T.trayTitle + '</h3><p>' + T.trayCount(n) + '</p></div>';
    var body;
    if (!n) {
      body = '<div class="hx-tray__body"><div class="hx-tray__empty">' + T.trayEmpty + '</div></div>';
    } else {
      body = '<div class="hx-tray__body">' + st.list.map(function (i) {
        return '<div class="hx-titem">' +
          (i.image ? '<img src="' + i.image + '" alt="">' : '<span style="width:44px;height:44px;background:#f4f2ee;border-radius:9px;display:inline-block"></span>') +
          '<div class="hx-titem__t">' + esc(trTitle(i.title)) + '</div>' +
          '<button class="hx-titem__x" data-rm="' + i.id + '" title="' + T.remove + '">×</button>' +
        '</div>';
      }).join('') + '</div>';
      // compare hint when 2+ of one category
      var counts = {}; st.list.forEach(function (i) { counts[i.categoryId] = (counts[i.categoryId] || 0) + 1; });
      var dupId = Object.keys(counts).find(function (k) { return counts[k] > 1; });
      if (dupId) {
        var dt = TREE.find(function (x) { return x.id === dupId; });
        var q = encodeURIComponent(dt ? dt.name : '');
        body += '<div class="hx-compare">' + T.compareHint(dt ? catName(dt.name) : '') +
          '<a href="compare.html?q=' + q + '">' + T.compareLink + '</a></div>';
      }
      body += '<div class="hx-tray__perks">' +
        '<div><b>✓</b> ' + T.perkTry + '</div>' +
        '<div><b>✓</b> ' + T.perkGuide + '</div>' +
        '<div><b>✓</b> ' + T.perkMeal + '</div></div>';
    }
    $('hxTray').innerHTML = head + body;
    $('hxNext1').disabled = n === 0;
  }

  /* ---------------- STEP 2: branch ---------------- */
  function renderBranches() {
    $('hxBranches').innerHTML = st.branches.map(function (b) {
      return '<button class="hx-branch' + (b.id === st.branch ? ' on' : '') + '" data-branch="' + b.id + '">' +
        '<span class="hx-branch__region' + (b.seasonal ? ' season' : '') + '">' + (EN ? b.regionEn : b.region) + '</span>' +
        '<h3>' + (EN ? b.nameEn : b.name) + '</h3>' +
        '<address>' + (EN ? b.addressEn : b.address) + '</address>' +
        '<span class="hx-branch__tick">' + T.pick + '</span></button>';
    }).join('') + (st.branches.some(function (b) { return b.seasonal; }) ? '<p class="hx-season-note">' + T.seasonNote + '</p>' : '');
    $('hxNext2').disabled = !st.branch;
  }

  /* ---------------- STEP 3: date & time ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function renderDays() {
    var today = new Date(); var html = '';
    for (var i = 0; i < 21; i++) {
      var d = new Date(today); d.setDate(today.getDate() + i);
      var val = ymd(d), on = val === st.date;
      html += '<button class="hx-day' + (on ? ' on' : '') + '" data-day="' + val + '">' +
        '<div class="hx-day__dow">' + T.dow[d.getDay()] + '</div>' +
        '<div class="hx-day__d">' + d.getDate() + '</div>' +
        '<div class="hx-day__m">' + T.mon[d.getMonth()] + '</div></button>';
    }
    $('hxDays').innerHTML = html;
  }
  function loadSlots() {
    if (!st.branch || !st.date) return;
    var wrap = $('hxSlotWrap'); wrap.hidden = false;
    $('hxSlots').innerHTML = '<span class="hx-hint">' + T.slotsLoading + '</span>';
    fetch('/api/experience/slots?branch=' + encodeURIComponent(st.branch) + '&date=' + encodeURIComponent(st.date))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.slots || !j.slots.length) { $('hxSlots').innerHTML = '<span class="hx-hint">' + T.noSlots + '</span>'; return; }
        $('hxSlots').innerHTML = j.slots.map(function (s) {
          return '<button class="hx-slot' + (s.taken ? ' taken' : '') + (s.time === st.time ? ' on' : '') + '"' +
            (s.taken ? ' disabled' : ' data-slot="' + s.time + '"') + '>' + s.time + '</button>';
        }).join('');
      })
      .catch(function () { $('hxSlots').innerHTML = '<span class="hx-hint">' + T.noSlots + '</span>'; });
  }

  /* ---------------- STEP 4: validation ---------------- */
  function validPhone(raw) {
    var d = String(raw || '').replace(/[\s\-()]/g, '');
    return /^(?:\+?20|0)?1[0125]\d{8}$/.test(d) || /^0\d{8,9}$/.test(d);
  }
  function validateDetails() {
    st.name = $('hxName').value.trim(); st.phone = $('hxPhone').value.trim(); st.notes = $('hxNotes').value.trim();
    var okN = st.name.length >= 2, okP = validPhone(st.phone);
    $('fName').classList.toggle('bad', !okN);
    $('fPhone').classList.toggle('bad', !okP);
    return okN && okP;
  }

  /* ---------------- STEP 5: review ---------------- */
  function branchObj() { return st.branches.find(function (b) { return b.id === st.branch; }); }
  function prettyDate() {
    if (!st.date) return '';
    var d = new Date(st.date + 'T00:00:00');
    return T.dow[d.getDay()] + ' ' + d.getDate() + ' ' + T.mon[d.getMonth()];
  }
  function renderReview() {
    var b = branchObj();
    var devs = st.list.map(function (i) {
      return '<div class="hx-rc__dev">' +
        (i.image ? '<img src="' + i.image + '" alt="">' : '<span style="width:38px;height:38px;background:#f4f2ee;border-radius:8px;display:inline-block"></span>') +
        '<span class="hx-rc__line">' + esc(trTitle(i.title)) + ' — <b style="direction:ltr">' + money(i.price) + ' ' + T.egp + '</b></span></div>';
    }).join('');
    $('hxReview').innerHTML =
      '<div class="hx-rc"><h4>🛋️ ' + T.rDevices + ' (' + st.list.length + ')<button class="hx-rc__edit" data-goto="1">' + T.edit + '</button></h4>' + devs + '</div>' +
      '<div class="hx-rc"><h4>📍 ' + T.rBranch + '<button class="hx-rc__edit" data-goto="2">' + T.edit + '</button></h4>' +
        '<div class="hx-rc__line">' + (b ? (EN ? b.nameEn : b.name) + ' — ' + (EN ? b.addressEn : b.address) : '') + '</div></div>' +
      '<div class="hx-rc"><h4>🗓️ ' + T.rWhen + '<button class="hx-rc__edit" data-goto="3">' + T.edit + '</button></h4>' +
        '<div class="hx-rc__line">' + prettyDate() + ' · <span style="direction:ltr">' + (st.time || '') + '</span></div></div>' +
      '<div class="hx-rc"><h4>👤 ' + T.rYou + '<button class="hx-rc__edit" data-goto="4">' + T.edit + '</button></h4>' +
        '<div class="hx-rc__line">' + esc(st.name) + ' · <span style="direction:ltr">' + esc(st.phone) + '</span>' +
        (st.notes ? '<br>' + esc(st.notes) : '') + '</div></div>';
  }

  /* ---------------- confirm / book ---------------- */
  function confirmBooking() {
    var btn = $('hxConfirm'); btn.disabled = true; $('hxConfirmHint').textContent = T.booking;
    fetch('/api/experience/book', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branch: st.branch, date: st.date, time: st.time, name: st.name, phone: st.phone, notes: st.notes,
        devices: st.list.map(function (i) { return { id: i.id, title: i.title, image: i.image, price: i.price, category: i.category }; }),
      }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false; $('hxConfirmHint').textContent = '';
        if (res.ok && res.j.ref) { renderDone(res.j.ref); return; }
        toast(res.j.error === 'slot-full' ? T.errSlotFull : T.errGeneric);
        if (res.j.error === 'slot-full') { show(3); loadSlots(); }
      })
      .catch(function () { btn.disabled = false; $('hxConfirmHint').textContent = ''; toast(T.errGeneric); });
  }
  function renderDone(ref) {
    var b = branchObj();
    $('hxDone').innerHTML =
      '<div class="hx-done__mark">✓</div>' +
      '<h2>' + T.doneTitle + '</h2>' +
      '<p>' + T.doneLead + '</p>' +
      '<div class="hx-ref"><small style="font-weight:700;font-size:.7em;opacity:.7;letter-spacing:0">' + T.refLabel + '</small><br>' + ref + '</div>' +
      '<div class="hx-done__card">' +
        '<div class="hx-rc__line">📍 ' + (b ? (EN ? b.nameEn : b.name) : '') + '</div>' +
        '<div class="hx-rc__line">🗓️ ' + prettyDate() + ' · <span style="direction:ltr">' + (st.time || '') + '</span></div>' +
        '<div class="hx-rc__line">🛋️ ' + T.pcount(st.list.length) + '</div>' +
      '</div>' +
      '<div class="hx-callout">' + T.callout + '</div>' +
      '<div class="hx-nav" style="justify-content:center">' +
        '<button class="hx-next" data-reset>' + T.bookAnother + '</button>' +
        '<a class="hx-back" href="shop.html" style="text-decoration:none">' + T.goShop + '</a></div>';
    // booking done — clear the room
    st.list = []; writeList(st.list);
    show(6);
  }

  /* ---------------- utils ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var toastT;
  function toast(msg) { var e = $('hxToast'); e.textContent = msg; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('show'); }, 1600); }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cat],[data-sub],[data-add],[data-rm],[data-branch],[data-day],[data-slot],[data-goto],[data-back],[data-reset]');
    if (!t) return;
    if (t.hasAttribute('data-cat')) { st.cat = t.getAttribute('data-cat'); st.sub = null; renderCats(); renderGrid(); }
    else if (t.hasAttribute('data-sub')) { var s = t.getAttribute('data-sub'); st.sub = st.sub === s ? null : s; renderCats(); renderGrid(); }
    else if (t.hasAttribute('data-add')) addDevice(t.getAttribute('data-add'));
    else if (t.hasAttribute('data-rm')) removeDevice(t.getAttribute('data-rm'));
    else if (t.hasAttribute('data-branch')) { st.branch = t.getAttribute('data-branch'); renderBranches(); }
    else if (t.hasAttribute('data-day')) { st.date = t.getAttribute('data-day'); st.time = null; renderDays(); $('hxNext3').disabled = true; loadSlots(); }
    else if (t.hasAttribute('data-slot')) { st.time = t.getAttribute('data-slot'); document.querySelectorAll('.hx-slot').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-slot') === st.time); }); $('hxNext3').disabled = false; }
    else if (t.hasAttribute('data-back')) show(st.step - 1);
    else if (t.hasAttribute('data-reset')) { st.branch = null; st.date = null; st.time = null; renderBranches(); renderTray(); renderGrid(); show(1); }
    else if (t.hasAttribute('data-goto')) {
      var g = +t.getAttribute('data-goto');
      if (g <= st.maxReached || g <= st.step) show(g);
    }
  });
  $('hxNext1').addEventListener('click', function () { if (st.list.length) show(2); });
  $('hxNext2').addEventListener('click', function () { if (st.branch) show(3); });
  $('hxNext3').addEventListener('click', function () { if (st.date && st.time) show(4); });
  $('hxNext4').addEventListener('click', function () { if (validateDetails()) show(5); });
  $('hxConfirm').addEventListener('click', confirmBooking);

  /* ---------------- boot ---------------- */
  renderRail(); renderCats(); renderTray(); renderDays();
  fetch('data/products.json').then(function (r) { return r.json(); }).then(function (j) {
    st.products = (j.products || []).filter(function (p) { return typeof p.price === 'number' && p.price > 0; });
    renderGrid();
  }).catch(function () { $('hxGrid').innerHTML = '<p class="hx-empty">—</p>'; });
  fetch('/api/experience/branches').then(function (r) { return r.json(); }).then(function (j) {
    st.branches = j.branches || []; renderBranches();
  }).catch(function () {
    // fallback: read the static data file directly if the API is unavailable
    fetch('data/branches.json').then(function (r) { return r.json(); }).then(function (j) { st.branches = j.branches || []; renderBranches(); }).catch(function () {});
  });
  show(1);
})();
