/* ============================================================================
   SADKO catalog i18n — rule-based Arabic→English translator for product text.
   ----------------------------------------------------------------------------
   The catalog (products.json + prebuilt category cards) exists only in Arabic;
   titles are formulaic — [type] [brand] [specs…] [latin model code] — so a
   vocabulary dictionary + phrase pass translates them faithfully at runtime.

   window.skCatalogI18n = {
     translate(text)       — generic AR→EN pass (keeps latin/model codes as-is)
     translateTitle(text)  — translate + move the brand to the front + cleanup
   }
   Unknown Arabic tokens are left untouched (visible, not silently dropped).
   ========================================================================== */

(function () {
  const norm = w => w
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ً-ْ]/g, '');

  /* phrases first (matched greedily, longest run wins), then single tokens */
  const RAW = {
    // ---- multi-word phrases ----
    'مبرد مياه': 'Water Dispenser', 'سخان مياه': 'Water Heater', 'غسالة ملابس': 'Washing Machine',
    'غسالة اطباق': 'Dishwasher', 'ديب فريزر': 'Deep Freezer', 'قلاية هوائية': 'Air Fryer',
    'غاز طبيعى': 'Natural Gas', 'بدون فريم': 'Frameless', 'ال جى': 'LG', 'ال جي': 'LG',
    'واى فاى': 'Wi-Fi', 'واي فاي': 'Wi-Fi', 'بيلت ان': 'Built-in', 'فري ستاند': 'Freestanding',
    'محضر طعام': 'Food Processor', 'محضرات طعام': 'Food Processors', 'مطحنة بن': 'Coffee Grinder',
    'ماكينة قهوة': 'Coffee Machine', 'ساندوتش ميكر': 'Sandwich Maker', 'غزل بنات': 'Cotton Candy Maker',
    'وايت ويل': 'White Whale', 'لا جيرمانيا': 'La Germania', 'مقاومة للصدمات': 'Shock-Resistant',
    'مقاوم للصداء': 'Rust-Resistant', 'اشعال ذاتى': 'Self-Ignition', 'مولدة للبخار': 'Steam-Generating',
    'حوامل زهر': 'Cast-Iron Pan Supports', 'مجفف ملابس': 'Clothes Dryer', 'مجففات ملابس': 'Clothes Dryers',
    'فتحة علوية': 'Top-Loading', 'جهاز تحكم': 'Remote Control', 'د يجيتال': 'Digital',
    'اسبيرسو وكاباتشينو': 'Espresso & Cappuccino', 'فريزر افقى': 'Chest Freezer', 'فريزر رأسى': 'Upright Freezer',
    'نو فروست': 'No-Frost', 'قطع غيار': 'Spare Parts', 'حلل كهربائية': 'Electric Pots',
    'متعدد الاسلحة': 'Multi-Attachment', 'خشب سرسوع': 'Sarsoua Wood', 'ال إى دى': 'LED',
    'دى لوكس': 'Deluxe', 'ديب فريز': 'Deep Freezer', 'بقوة': 'with Power',

    // ---- brands ----
    'فريش': 'Fresh', 'تورنيدو': 'Tornado', 'تورنادو': 'Tornado', 'تونيدو': 'Tornado',
    'كريازى': 'Kiriazi', 'كريازي': 'Kiriazi', 'سوكانى': 'Sokany', 'سوكاني': 'Sokany',
    'ميانتا': 'Mienta', 'ميديا': 'Midea', 'توشيبا': 'Toshiba', 'شارب': 'Sharp', 'هاير': 'Haier',
    'بلوتو': 'Pluto', 'بيكو': 'Beko', 'باناسونيك': 'Panasonic', 'سامسونج': 'Samsung',
    'زانوسي': 'Zanussi', 'زانوسى': 'Zanussi', 'كاريير': 'Carrier', 'اريستون': 'Ariston',
    'مولينكس': 'Moulinex', 'جالانز': 'Galanz', 'الاسكا': 'Alaska', 'اوليمبك': 'Olympic',
    'دايو': 'Daewoo', 'كولدير': 'Koldair', 'هوفر': 'Hoover', 'البا': 'Elba', 'شتيبل': 'Stiebel',
    'لاجيرمانيا': 'La Germania', 'جيرمانيا': 'Germania', 'هيرو': 'Hero', 'بريميير': 'Premiere',
    'جورنيا': 'Gourmia', 'العربى': 'ElAraby', 'هامر': 'Hammer', 'هيلير': 'Heller', 'نوفا': 'Nova',

    // ---- product types ----
    'ثلاجة': 'Refrigerator', 'ثلاجه': 'Refrigerator', 'فريزر': 'Freezer', 'غسالة': 'Washing Machine',
    'بوتاجاز': 'Cooker', 'بوتجاز': 'Cooker', 'فرن': 'Oven', 'طباخ': 'Cooker',
    'ميكروويف': 'Microwave', 'ميكرويف': 'Microwave', 'ميكروييف': 'Microwave',
    'تكييف': 'Air Conditioner', 'تكيف': 'Air Conditioner', 'اسبليت': 'Split',
    'سخان': 'Water Heater', 'مروحة': 'Fan', 'مبرد': 'Cooler', 'مكنسة': 'Vacuum Cleaner',
    'مكواة': 'Iron', 'مكوة': 'Iron', 'مكواه': 'Iron', 'غلاية': 'Kettle', 'غلايه': 'Kettle',
    'كاتيل': 'Kettle', 'خلاط': 'Blender', 'بلندر': 'Blender', 'بليندر': 'Blender',
    'مضرب': 'Mixer', 'عجان': 'Dough Mixer', 'مطحنة': 'Grinder', 'مطحنه': 'Grinder',
    'كبة': 'Chopper', 'كبه': 'Chopper', 'قطاعة': 'Chopper', 'مبشرة': 'Grater', 'عصاره': 'Juicer',
    'توستر': 'Toaster', 'شواية': 'Grill', 'جريل': 'Grill', 'جرل': 'Grill', 'شفاط': 'Hood',
    'دفاية': 'Heater', 'دفايه': 'Heater', 'دفادية': 'Heater', 'تليفزيون': 'TV', 'تلفزيون': 'TV',
    'شاشة': 'Screen', 'ماكينة': 'Machine', 'محضر': 'Processor', 'ميكر': 'Maker', 'مجفف': 'Dryer',
    'قلاية': 'Fryer', 'ابريق': 'Pitcher', 'سلة': 'Basket', 'سبت': 'Basket', 'توابل': 'Spice Set',

    // ---- specs & units ----
    'لتر': 'Liter', 'وات': 'Watt', 'واط': 'Watt', 'باط': 'Watt', 'بوصة': 'Inch', 'سم': 'cm',
    'مم': 'mm', 'ملى': 'ml', 'مل': 'ml', 'قدم': 'Feet', 'كيلو': 'Kg', 'حصان': 'HP',
    'جرام': 'Gram', 'شعلة': 'Burners', 'عين': 'Burner', 'باب': 'Door', 'درج': 'Drawer',
    'حنفية': 'Tap', 'لفة': 'RPM', 'سرعات': 'Speeds', 'سرعة': 'Speed', 'سرعه': 'Speed',
    'سرعتين': '2-Speed', 'سرعتان': '2-Speed', 'برنامج': 'Programs', 'كوب': 'Cup', 'بار': 'Bar',
    'قطعة': 'Pieces', 'سعة': 'Capacity', 'خزان': 'Tank', 'حمل': 'Load', 'تحميل': 'Loading',
    'حوضين': 'Twin-Tub', 'مروحتين': '2 Fans', 'قوة': 'Power', 'شفط': 'Suction', 'حجم': 'Size',

    // ---- colors & materials ----
    'اسود': 'Black', 'أسود': 'Black', 'اسو': 'Black', 'ابيض': 'White', 'فضى': 'Silver',
    'فضي': 'Silver', 'سيلفر': 'Silver', 'رمادى': 'Gray', 'رمادي': 'Gray', 'جراي': 'Gray',
    'جراى': 'Gray', 'احمر': 'Red', 'ازرق': 'Blue', 'بنى': 'Brown', 'ذهبي': 'Gold', 'جولد': 'Gold',
    'روز': 'Rose', 'كريمى': 'Cream', 'غامق': 'Dark', 'درك': 'Dark', 'شبح': 'Ghost',
    'ميدنايت': 'Midnight', 'ميتالك': 'Metallic', 'موراندي': 'Morandi', 'موروندي': 'Morandi',
    'استيل': 'Steel', 'ستيل': 'Steel', 'ستانلس': 'Stainless', 'استانلس': 'Stainless',
    'استنالس': 'Stainless', 'استنلس': 'Stainless', 'استانل': 'Stainless', 'اينوكس': 'Inox',
    'زجاج': 'Glass', 'زجاجي': 'Glass', 'بلاستيك': 'Plastic', 'خشب': 'Wood', 'سيراميك': 'Ceramic',
    'تيتانيوم': 'Titanium', 'كروم': 'Chrome', 'فخار': 'Clay', 'خوص': 'Wicker', 'زهر': 'Cast Iron',
    'اكليرك': 'Acrylic', 'كرستال': 'Crystal', 'البولى': 'Poly', 'كربونيت': 'Carbonate',

    // ---- features ----
    'نوفروست': 'No-Frost', 'ديفروست': 'Defrost', 'انفرتر': 'Inverter', 'ديجيتال': 'Digital',
    'سمارت': 'Smart', 'تايمر': 'Timer', 'تربو': 'Turbo', 'توربو': 'Turbo', 'ريموت': 'Remote',
    'بالريموت': 'with Remote', 'ريسيفر': 'Receiver', 'رسيفر': 'Receiver', 'برسيفر': 'with Receiver',
    'بالريسيفر': 'with Receiver', 'بالرسيفر': 'with Receiver', 'ريسيفرداخلى': 'Built-in Receiver',
    'داخلى': 'Built-in', 'اندرويد': 'Android', 'جوجل': 'Google', 'بلازما': 'Plasma',
    'البلازما': 'Plasma', 'ليد': 'LED', 'تاتش': 'Touch', 'باللمس': 'Touch', 'ميكانيكال': 'Mechanical',
    'اتوماتيك': 'Automatic', 'اوتوماتيك': 'Automatic', 'اوماتيك': 'Automatic', 'يدوى': 'Manual',
    'يدوي': 'Manual', 'كهرباء': 'Electric', 'كهربائي': 'Electric', 'الكهربائى': 'Electric',
    'غاز': 'Gas', 'بخار': 'Steam', 'بالبخار': 'with Steam', 'ستيم': 'Steam', 'استيم': 'Steam',
    'بارد': 'Cold', 'ساخن': 'Hot', 'سخن': 'Hot', 'تبريد': 'Cooling', 'تسخين': 'Heating',
    'وتسخين': '& Heating', 'تجميد': 'Freezing', 'اذابة': 'Defrost', 'امان': 'Safety',
    'اشعال': 'Ignition', 'ذاتى': 'Self', 'زاتي': 'Self', 'فوري': 'Instant', 'سريع': 'Fast',
    'هايجين': 'Hygiene', 'انبوبة': 'LPG', 'طبيعى': 'Natural', 'طبيعي': 'Natural', 'عادى': 'Regular',
    'نصف': 'Half', 'كامل': 'Full', 'متعدد': 'Multi', 'مينى': 'Mini', 'ماكس': 'Max', 'مسطح': 'Flat',
    'عريض': 'Wide', 'كبير': 'Large', 'صغير': 'Small', 'وسط': 'Medium', 'طويل': 'Tall',
    'دائرى': 'Round', 'هرمى': 'Pyramid', 'مزود': 'with', 'مزودة': 'with', 'بدون': 'Without',
    'فقط': 'Only', 'جديد': 'New', 'طراز': 'Model', 'لون': 'Color', 'صافى': 'Net', 'صافي': 'Net',
    'فريم': 'Frame', 'مقبض': 'Handle', 'قاعدة': 'Base', 'حامل': 'Holder', 'حوامل': 'Pan Supports',
    'طبق': 'Plate', 'طقم': 'Set', 'ملحقات': 'Accessories', 'رف': 'Shelf', 'شبكة': 'Mesh',
    'شبك': 'Mesh', 'بالشكبة': 'with Mesh', 'قوائم': 'Legs', 'عجل': 'Wheels', 'بالعجل': 'with Wheels',
    'متحرك': 'Mobile', 'محمولة': 'Portable', 'رحلات': 'Travel', 'حائطى': 'Wall-Mounted',
    'حائطي': 'Wall-Mounted', 'حائط': 'Wall', 'مكتب': 'Desk', 'مكتبى': 'Desk', 'علوية': 'Top',
    'علوي': 'Top', 'علوى': 'Top', 'سفلية': 'Bottom', 'سفلى': 'Bottom', 'رأسى': 'Upright',
    'رأسي': 'Upright', 'افقى': 'Chest', 'افقي': 'Chest', 'جانبي': 'Side', 'جوانب': 'Sides',
    'فوق': 'Above', 'فتحة': 'Opening', 'فصل': 'Detachable', 'بلاطة': 'Hotplate', 'بلاطه': 'Hotplate',
    'ريشة': 'Blade', 'وشفرات': '& Blades', 'مضخة': 'Pump', 'بالطلمبة': 'with Pump',
    'شاحن': 'Charger', 'بالشاحن': 'with Charger', 'وبطارية': '& Battery', 'تحكم': 'Control',
    'كنترول': 'Control', 'خاصية': 'Feature', 'بخاصية': 'with Feature', 'وظيفة': 'Function',
    'ونبض': '& Pulse', 'تشغيل': 'Operation', 'تنظيف': 'Cleaning', 'غسيل': 'Washing',
    'بالمكثف': 'with Condenser', 'بمجفف': 'with Dryer', 'بالمروحة': 'with Fan',
    'بمضرب': 'with Mixer', 'بمطحنة': 'with Grinder', 'بالخلاط': 'with Blender',
    'ومبشرة': '& Grater', 'بقلاية': 'with Fryer', 'بالشواية': 'with Grill', 'بشواية': 'with Grill',
    'بالجريل': 'with Grill', 'بغطاء': 'with Lid', 'بدرج': 'with Drawer', 'بالثلاجة': 'with Fridge',
    'مطلية': 'Coated', 'مغطى': 'Coated', 'بطبقة': 'with a Layer', 'لتجميع': 'for Collecting',
    'الزيوت': 'Oils', 'زيت': 'Oil', 'مياه': 'Water', 'مياة': 'Water', 'هواء': 'Air',
    'هوائية': 'Air', 'بيض': 'Egg', 'بصل': 'Onion', 'ثوم': 'Garlic', 'ملوخية': 'Molokhia',
    'وملوخية': '& Molokhia', 'خبز': 'Bread', 'قهوة': 'Coffee', 'بن': 'Coffee', 'فطار': 'Breakfast',
    'سناكس': 'Snacks', 'تقديم': 'Serving', 'طهي': 'Cooking', 'حمام': 'Bathroom', 'بنات': 'Girls',
    'فرد': 'Hair Straightener', 'هاند': 'Hand', 'استاند': 'Stand', 'ستاند': 'Stand',
    'استاندر': 'Standard', 'ستاندر': 'Standard', 'اكسترا': 'Extra', 'بلاس': 'Plus', 'بلس': 'Plus',
    'سولو': 'Solo', 'كومبى': 'Combi', 'توب': 'Top', 'كوول': 'Cool', 'سوفت': 'Soft',
    'هيدروليك': 'Hydraulic', 'هيدرولبك': 'Hydraulic', 'كواترو': 'Quattro', 'بانورما': 'Panorama',
    'ماتريكس': 'Matrix', 'كلاستر': 'Cluster', 'أوبتيماكس': 'Optimax', 'اوبتى': 'Opti',
    'شيف': 'Chef', 'بليندفورس': 'Blendforce', 'جوكر': 'Joker', 'الجوكر': 'Joker', 'لوكس': 'Lux',
    'بروفيشنال': 'Professional', 'فالورى': 'Valori', 'بلازا': 'Plaza', 'بريمو': 'Primo',
    'فورنو': 'Forno', 'سوليتير': 'Solitaire', 'اليجنت': 'Elegant', 'بيرلا': 'Perla',
    'بلاتينيوم': 'Platinum', 'ستار': 'Star', 'نايس': 'Nice', 'كاسا': 'Casa', 'ترندى': 'Trendy',
    'سوبريمو': 'Supremo', 'كاريوكا': 'Karioka', 'فولكانو': 'Volcano', 'مرجانة': 'Margana',
    'زمرده': 'Zomoroda', 'فيروزة': 'Fayrouza', 'لونج': 'Long', 'لايف': 'Life', 'المطور': 'Advanced',
    'اكواانتنس': 'AquaIntense', 'كلوز': 'Close', 'تيست': 'Toast', 'ميكس': 'Mix', 'فريز': 'Freeze',
    'مصري': 'Egyptian', 'مصرى': 'Egyptian', 'محلي': 'Local', 'محلى': 'Local', 'المانى': 'German',
    'ماليزي': 'Malaysian', 'ياباني': 'Japanese', 'تركى': 'Turkish', 'معدل': 'Adjustable',
    'مقاومة': 'Resistant', 'مقاوم': 'Resistant', 'واى': 'Wi', 'فاى': 'Fi', 'واي': 'Wi', 'فاي': 'Fi',
    'بيلت': 'Built', 'ان': 'In', 'جهاز': 'Device', 'ثلاثة': 'Three', 'واحد': 'One', 'واحدة': 'One',
    'مع': 'with', 'من': 'from', 'فى': 'in', 'في': 'in', 'و': '&', 'وقت': 'Time', 'عناية': 'Care',
    'ملابس': 'Clothes', 'اليكتريك': 'Electric', 'تانك': 'Tank', 'بادر': 'Cold', 'كى': 'Ironing',
    'مزخرف': 'Decorated', 'دى': 'D', 'إى': 'E', 'ك': 'Kg', 'ح': 'HP', 'س': 'S', 'ب': 'B',
    'ط': '', 'ش': '', 'م': '',

    // ---- glued compounds seen in the catalog ----
    'بلندرسوكانى': 'Sokany Blender', 'بوتجاززانوسى': 'Zanussi Cooker', 'بوتاجاززانوسي': 'Zanussi Cooker',
    'تبريدوتسخين': 'Cooling & Heating', 'تبريدوفرن': 'Cooling & Oven', 'بخاراستاند': 'Steam Stand',
    'انفرترنوفروست': 'Inverter No-Frost', 'بخارانفرترديجيتال': 'Steam Inverter Digital',
    'انفرتربخارسيلفررباب': 'Inverter Steam Silver Door', 'اسودباب': 'Black Door',
    'بالمروحةحوامل': 'with Fan, Pan Supports', 'زهرتاتش': 'Cast Iron, Touch', 'زهرش': 'Cast Iron',
    'ماريناامان': 'Marina Safety', 'يجيتال': 'igital',
  };

  const DICT = {};
  for (const k of Object.keys(RAW)) DICT[k.split(/\s+/).map(norm).join(' ')] = RAW[k];

  const BRAND_EN = new Set(['Fresh', 'Tornado', 'Kiriazi', 'Sokany', 'Mienta', 'Midea', 'Toshiba',
    'Sharp', 'Haier', 'Pluto', 'Beko', 'Panasonic', 'Samsung', 'Zanussi', 'Carrier', 'Ariston',
    'Moulinex', 'Galanz', 'Alaska', 'Olympic', 'Daewoo', 'Koldair', 'Hoover', 'Elba', 'Stiebel',
    'Hero', 'Premiere', 'Gourmia', 'ElAraby', 'LG', 'La Germania', 'White Whale']);

  const AR = /[؀-ۿ]/;
  const digits = s => s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٬/g, ',').replace(/٫/g, '.').replace(/،/g, ',');

  function translate(text) {
    let t = String(text || '').replace(/&nbsp;| /g, ' ');
    t = digits(t).replace(/ـ+/g, ' - ').replace(/ب\s*\/\s*س/g, 'Cold/Hot')
      // detach punctuation/digits glued to Arabic words so dictionary keys match
      .replace(/([؀-ۿ])([\/\-+,()«»:;.*–—])/g, '$1 $2 ')
      .replace(/([\/\-+,()«»:;.*–—])([؀-ۿ])/g, ' $1 $2')
      .replace(/(\d)([؀-ۿ])/g, '$1 $2').replace(/([؀-ۿ])(\d)/g, '$1 $2')
      .replace(/([A-Za-z])([؀-ۿ])/g, '$1 $2').replace(/([؀-ۿ])([A-Za-z])/g, '$1 $2');
    // walk word-by-word; try 3→2→1-word dictionary phrases over Arabic runs
    const parts = t.split(/(\s+)/);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i];
      if (!AR.test(w)) { out.push(w); continue; }
      let hit = null, span = 1;
      for (const take of [5, 3, 1]) {         // parts indices: word, sep, word…
        if (i + take > parts.length) continue;
        const words = [];
        for (let j = i; j < i + take; j += 2) words.push(parts[j]);
        if (words.some(x => !AR.test(x))) continue;
        const key = words.map(norm).join(' ');
        if (DICT[key] !== undefined) { hit = DICT[key]; span = take; break; }
      }
      if (hit !== null) { out.push(hit); i += span - 1; }
      else out.push(w);                        // unknown token stays visible
    }
    return out.join('').replace(/\s{2,}/g, ' ').trim();
  }

  function translateTitle(text) {
    let t = translate(text);
    // English convention: brand leads — "Water Heater Kiriazi Gas" → "Kiriazi Water Heater Gas"
    for (const b of BRAND_EN) {
      const re = new RegExp('(^|\\s)' + b.replace(/\s/g, '\\s') + '(\\s|$)');
      const m = t.match(re);
      if (m && m.index > 0) {
        t = (b + ' ' + t.replace(re, '$1').replace(/\s{2,}/g, ' ')).trim();
        break;
      }
    }
    // drop immediate case-insensitive duplicates ("Black BLACK", "Electric Electric") —
    // after brand-fronting, which can itself reunite a duplicate pair
    return t.split(' ').filter((w, i, a) => !i || w.toLowerCase() !== a[i - 1].toLowerCase()).join(' ');
  }

  window.skCatalogI18n = { translate, translateTitle };
})();
