/**
 * Seed script: push keyword lists into the categories.keywords column.
 *
 * Run once (and again any time you want to add more defaults):
 *   node scripts/seedCategoryKeywords.js
 *
 * Strategy:
 *  - For each entry below, find the category in DB by name (case-insensitive).
 *  - If found  → MERGE the new keywords with whatever is already stored.
 *  - If not found → CREATE the category with these keywords (user_id = NULL).
 *
 * Existing keywords that were manually added in the UI are preserved.
 */

const pool = require('../config/database');

// ---------------------------------------------------------------------------
// Default keyword seeds (category name → keywords[])
// ---------------------------------------------------------------------------
const SEEDS = [

  // ── ATM Withdrawal ────────────────────────────────────────────────────────
  {
    name: 'ATM Withdrawal',
    keywords: [
      'nwd-', 'atw-', '/atm/', 'atm withdrawal', 'cash withdrawal',
      'cash@atm', 'atm/nwd', 'atm cash',
    ],
  },

  // ── Travel ────────────────────────────────────────────────────────────────
  {
    name: 'Travel',
    keywords: [
      'redbus', 'red bus', 'redbus2bus',
      'irctc', 'indianrailway', 'indian railway', 'railyatri', 'ixigo',
      'makemytrip', 'goibibo', 'cleartrip', 'yatra.com', 'easemytrip', 'abhibus',
      'indigo airlines', 'air india', 'vistara', 'spicejet', 'akasa air', 'go first', 'air asia',
      'airlines booking', 'airways booking', 'airport lounge', 'airport tax',
      'bus ticket', 'train ticket', 'flight booking', 'flight ticket',
      'oyo rooms', 'oyo hotel', 'treebo', 'fab hotel',
      'travel booking', 'tour package', 'holiday package',
    ],
  },

  // ── Transport / Fuel ──────────────────────────────────────────────────────
  {
    name: 'Transport / Fuel',
    keywords: [
      'uber', 'ola cab', 'ola ride', 'rapido', 'meru cab', 'blu smart',
      'petrol pump', 'petrol bunk', 'petrol station', 'fuel station',
      'hpcl', 'iocl', 'bpcl', 'indian oil', 'bharat petroleum', 'hindustan petroleum',
      'hp petrol', 'essar petrol', 'shell petrol',
      'diesel fill', 'cng fill', 'fuel fill',
      'fastag', 'toll tax', 'toll plaza', 'highway toll',
      'metro card', 'metro recharge', 'chennai metro', 'bmtc', 'apsrtc', 'tnstc', 'msrtc',
      'auto rickshaw', 'parking fee', 'parking charges',
    ],
  },

  // ── Mutual Funds ──────────────────────────────────────────────────────────
  {
    name: 'Mutual Funds',
    keywords: [
      'mf utilities', 'mfutilities', 'mf-utilities', 'bd-mf', 'mf lump', 'lumpsum mf',
      'mutual fund', 'mutualfund', 'mf sip', 'sip payment',
      'motilal oswal mf', 'nippon india mf', 'mirae asset mf',
      'axis mutual fund', 'sbi mutual fund', 'hdfc mutual fund',
      'icici prudential mf', 'franklin templeton', 'dsp mutual fund',
      'kotak mutual fund', 'uti mutual fund', 'aditya birla mf',
      'sundaram mutual', 'tata mutual fund', 'parag parikh mf',
      'coin by zerodha', 'groww mf', 'kuvera', 'elss investment',
      'nfo subscription', 'systematic investment',
    ],
  },

  // ── Shares ────────────────────────────────────────────────────────────────
  {
    name: 'Shares',
    keywords: [
      'zerodha', 'groww', 'upstox', 'angel broking', 'angel one',
      'icici direct', '5paisa', 'edelweiss broking', 'sharekhan',
      'hdfc securities', 'kotak securities', 'sbi securities',
      'nse clearing', 'bse clearing', 'smallcase', 'sensibull',
      'stock purchase', 'equity investment', 'ipo allotment', 'ipo payment',
      'demat account', 'trading account', 'brokerage',
    ],
  },

  // ── Fixed Deposits ────────────────────────────────────────────────────────
  {
    name: 'Fixed Deposits',
    keywords: [
      'fixed deposit', 'fd booking', 'fd creation', 'fd renewal',
      'term deposit', 'recurring deposit', 'rd deposit', 'rd installment',
    ],
  },

  // ── Gold ──────────────────────────────────────────────────────────────────
  {
    name: 'Gold',
    keywords: [
      'sovereign gold bond', 'sgb', 'digital gold', 'mmtc gold', 'safegold',
      'tanishq', 'kalyan jewellers', 'joyalukkas', 'malabar gold',
      'grt jewellers', 'saravana jewellers', 'josco jewellers',
      'gold purchase', 'gold saving', 'gold scheme',
    ],
  },

  // ── Insurance Premiums ────────────────────────────────────────────────────
  {
    name: 'Insurance Premiums',
    keywords: [
      'lic premium', 'lic policy', 'life insurance premium',
      'star health', 'hdfc life', 'icici lombard', 'bajaj allianz',
      'kotak life insurance', 'tata aia', 'max life insurance',
      'reliance life', 'new india assurance', 'united india insurance',
      'national insurance', 'oriental insurance',
      'term plan premium', 'mediclaim premium', 'health insurance premium',
      'motor insurance', 'vehicle insurance', 'car insurance premium',
      'bike insurance premium', 'two wheeler insurance',
      'insurance premium', 'policy premium', 'insurance renewal',
    ],
  },

  // ── Credit Card ───────────────────────────────────────────────────────────
  {
    name: 'Credit Card',
    keywords: [
      'billpay', 'bill pay', 'ib billpay',
      'credit card bill', 'credit card payment', 'cc bill', 'cc payment',
      'hdfcve', 'hdfc5x', 'hdfc credit', 'icici credit card',
      'sbi card', 'axis credit card', 'kotak credit card', 'amex payment',
      'citi credit card', 'sc credit card', 'indusind credit card',
      'yes bank credit', 'rbl credit card', 'idfc credit card',
      'au bank credit', 'bob credit card', 'pnb credit card',
    ],
  },

  // ── Home Loan ─────────────────────────────────────────────────────────────
  {
    name: 'Home Loan',
    keywords: [
      'home loan emi', 'housing loan emi', 'hdfc home loan', 'lic housing',
      'sbi home loan', 'icici home loan', 'axis home loan',
      'pnb housing finance', 'bank of baroda home loan', 'canara home loan',
      'mortgage emi', 'housing finance emi', 'property loan',
    ],
  },

  // ── Personal Loan ─────────────────────────────────────────────────────────
  {
    name: 'Personal Loan',
    keywords: [
      'personal loan emi', 'pl emi', 'bajaj finserv emi', 'bajaj finance emi',
      'hdfc personal loan', 'icici personal loan', 'axis personal loan',
      'kotak personal loan', 'indusind personal loan',
      'tata capital loan', 'flexi loan', 'overdraft emi', 'consumer loan emi',
    ],
  },

  // ── Vehicle Loan ──────────────────────────────────────────────────────────
  {
    name: 'Vehicle Loan',
    keywords: [
      'vehicle loan emi', 'car loan emi', 'bike loan emi',
      'two wheeler loan', 'auto loan emi',
      'hdfc car loan', 'icici car loan', 'kotak car loan',
      'mahindra finance', 'bajaj auto finance', 'hero finance',
      'tvs credit', 'chola finance', 'sundaram finance',
    ],
  },

  // ── School / Education ────────────────────────────────────────────────────
  {
    name: 'School / Education',
    keywords: [
      'school fee', 'school fees', 'college fee', 'college fees',
      'tuition fee', 'tuition fees', 'coaching fee', 'coaching centre',
      'university fee', 'course fee', 'exam fee', 'admission fee',
      'hostel fee', 'education fee', 'library fee', 'lab fee',
      'cbse fee', 'board exam fee', 'jee coaching', 'neet coaching',
      'udemy', 'coursera', 'byju', 'byjus', 'unacademy',
      'whitehat jr', 'vedantu', 'toppr', 'khan academy',
    ],
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  {
    name: 'Utilities (EB, Water, Internet)',
    keywords: [
      'electricity bill', 'eb bill', 'power bill',
      'tangedco', 'tneb', 'bescom', 'msedcl', 'tpddl', 'bses',
      'kseb', 'reliance energy', 'torrent power', 'adani electricity',
      'water bill', 'metro water', 'bwssb', 'cmwssb', 'water charges',
      'piped gas', 'gas bill', 'indane gas', 'hp gas', 'bharat gas', 'mahanagar gas',
      'internet bill', 'broadband bill', 'wifi bill',
      'airtel broadband', 'jio fiber', 'act fiber', 'bsnl broadband',
      'hathway broadband', 'tikona', 'mtnl broadband',
      'utility payment', 'utility bill',
    ],
  },

  // ── Mobile Recharge ───────────────────────────────────────────────────────
  {
    name: 'Mobile Recharge',
    keywords: [
      'mobile recharge', 'prepaid recharge', 'recharge mobile',
      'airtel recharge', 'jio recharge', 'vi recharge', 'vodafone recharge',
      'bsnl recharge', 'mtnl recharge',
      'dth recharge', 'tata sky recharge', 'dish tv recharge',
      'sun direct recharge', 'videocon d2h', 'airtel dth',
      'gpayrecharge', 'phoneperecharge', 'paytm recharge',
    ],
  },

  // ── Subscriptions ─────────────────────────────────────────────────────────
  {
    name: 'Subscriptions',
    keywords: [
      'netflix', 'hotstar', 'disney hotstar', 'disney+ hotstar',
      'amazon prime', 'prime membership', 'prime video',
      'spotify', 'apple music', 'apple one', 'apple tv',
      'youtube premium', 'youtube music',
      'zee5', 'sony liv', 'sonyliv', 'jiocinema', 'voot', 'mxplayer',
      'linkedin premium', 'chatgpt plus', 'openai subscription',
      'microsoft 365', 'ms office', 'google one', 'icloud storage',
      'adobe subscription', 'canva pro', 'notion pro',
      'annual subscription', 'monthly subscription', 'membership renewal',
    ],
  },

  // ── Entertainment / OTT ───────────────────────────────────────────────────
  {
    name: 'Entertainment / OTT',
    keywords: [
      'bookmyshow', 'pvr cinemas', 'pvr movies', 'inox movies', 'inox multiplex',
      'carnival cinemas', 'cinepolis', 'miraj cinemas', 'spi cinemas',
      'movie ticket', 'cinema ticket', 'multiplex ticket',
      'amusement park', 'wonderla', 'imagica', 'theme park',
      'concert ticket', 'event ticket', 'live show ticket',
      'ticketnew', 'paytm insider', 'district by zomato',
    ],
  },

  // ── Dining / Food Delivery ────────────────────────────────────────────────
  {
    name: 'Dining / Food Delivery',
    keywords: [
      'swiggy', 'zomato', 'dunzo food', 'magicpin food',
      "domino's", 'dominos', 'pizza hut', 'kfc', 'mcdonalds',
      'subway', 'burger king', 'popeyes', 'taco bell',
      'starbucks', 'cafe coffee day', 'ccd', 'costa coffee',
      'biriyani', 'biryani', 'restaurant', 'food court',
      'mess payment', 'canteen payment', 'tiffin service',
      'hotel food', 'eatery', 'dine in', 'take away',
    ],
  },

  // ── Groceries ─────────────────────────────────────────────────────────────
  {
    name: 'Groceries',
    keywords: [
      'bigbasket', 'big basket', 'dmart grocery', 'jiomart', 'zepto',
      'blinkit', 'swiggy instamart', 'dunzo grocery', 'milkbasket',
      'country delight', 'milk delivery', 'dairy delivery',
      'reliance fresh', 'reliance smart', 'more supermarket', 'star bazaar',
      'nilgiris', 'nature basket', 'heritage fresh', 'spar hypermarket',
      'grocery store', 'grocery shop', 'supermarket', 'hypermarket',
      'kirana store', 'provision store', 'ration shop',
    ],
  },

  // ── Shopping ──────────────────────────────────────────────────────────────
  {
    name: 'Shopping',
    keywords: [
      'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa',
      'meesho', 'snapdeal', 'tatacliq', 'tata cliq',
      'croma', 'reliance digital', 'vijay sales', 'poorvika', 'sangeetha mobiles',
      'lulu mall', 'express avenue', 'phoenix mall', 'nexus mall',
      'clothing store', 'apparel', 'garments shop', 'footwear store',
      'sports goods', 'home decor store',
    ],
  },

  // ── Rent / Home EMI ───────────────────────────────────────────────────────
  {
    name: 'Rent / Home EMI',
    keywords: [
      'house rent', 'room rent', 'flat rent', 'apartment rent',
      'pg rent', 'pg payment', 'hostel rent', 'accommodation rent',
      'monthly rent', 'rent payment', 'rent transfer',
      'nobroker', 'palani rooms', 'paying guest', 'lodge payment',
    ],
  },

  // ── Medical (new category – created if not in DB) ─────────────────────────
  {
    name: 'Medical',
    keywords: [
      'pharmacy', 'medical store', 'medical shop', 'medicals', 'medico',
      'apollo pharmacy', 'medplus', 'netmeds', 'pharmeasy', '1mg pharmacy',
      'healthkart', 'wellness forever',
      'hospital', 'nursing home', 'clinic', 'health centre', 'health center',
      'dispensary', 'polyclinic', 'multispeciality', 'apollo hospital',
      'fortis hospital', 'manipal hospital', 'max hospital', 'miot hospital',
      'kauvery hospital', 'sims hospital',
      'doctor fee', 'doctor consultation', 'doctor visit', 'consultation fee',
      'specialist fee', 'physician fee',
      'medicine', 'medicines', 'tablet purchase', 'injection fee',
      'diagnostic centre', 'lab test', 'blood test', 'urine test',
      'scan fee', 'mri scan', 'ct scan', 'xray fee', 'ultrasound fee',
      'thyrocare', 'dr lal pathlabs', 'metropolis lab', 'apollo diagnostics',
      'dental clinic', 'dentist fee', 'teeth cleaning', 'root canal',
      'eye clinic', 'optician', 'spectacle', 'contact lens', 'lasik',
      'physiotherapy', 'physiotherapist',
      'homoeo', 'homeopathy', 'ayurveda clinic', 'siddha clinic', 'unani clinic',
      'practo', 'apollo 24/7', 'mfine', 'tata health',
    ],
  },

  // ── Vehicle Maintenance (new) ─────────────────────────────────────────────
  {
    name: 'Vehicle Maintenance',
    keywords: [
      'bike service', 'car service', 'vehicle service', 'auto service',
      'bike repair', 'car repair', 'two wheeler service', 'four wheeler service',
      'tyre replacement', 'tyre puncture', 'battery replacement',
      'motor works', 'motor garage', 'service centre', 'service center',
      'maruti service', 'honda service', 'tvs service', 'bajaj service',
      'royal enfield service', 'hero service', 'yamaha service',
      'car wash', 'bike wash', 'vehicle wash', 'car detailing',
      'oil change', 'engine service', 'brake repair', 'suspension repair',
    ],
  },

  // ── Home Maintenance (new) ────────────────────────────────────────────────
  {
    name: 'Home Maintenance',
    keywords: [
      'urbancompany', 'urban company', 'urbanclap', 'urban clap', 'sulekha',
      'plumber', 'plumbing', 'electrician', 'electrical repair',
      'carpenter', 'woodwork', 'pest control', 'termite control',
      'cleaning service', 'deep cleaning', 'home repair',
      'painting service', 'wall painting', 'renovation work',
      'pepperfry', 'urban ladder', 'ikea',
      'ac service', 'ac repair', 'washing machine service', 'fridge repair',
      'geyser repair', 'chimney service', 'ro service',
    ],
  },

  // ── Health & Fitness (new) ────────────────────────────────────────────────
  {
    name: 'Health & Fitness',
    keywords: [
      'gym membership', 'gym fee', 'fitness centre', 'fitness center',
      'cult fit', 'cult.fit', "gold's gym", 'gold gym', 'anytime fitness',
      'snap fitness', 'powerhouse gym', 'fitness first',
      'yoga class', 'yoga centre', 'yoga center', 'yoga studio',
      'meditation class', 'meditation centre', 'zumba class',
      'aerobics class', 'swimming class', 'swimming pool fee',
      'sports club fee', 'badminton court', 'tennis court',
      'protein supplement', 'whey protein', 'gym supplement', 'health supplement',
    ],
  },

  // ── Self Care (new) ───────────────────────────────────────────────────────
  {
    name: 'Self Care',
    keywords: [
      'hair cut', 'haircut', 'hair colour', 'hair color', 'hair treatment',
      'hair spa', 'blow dry', 'hair styling',
      'beauty salon', 'beauty parlour', 'beauty parlor',
      'men salon', 'ladies salon', 'unisex salon',
      'jawed habib', 'naturals salon', 'green trends', 'lakme salon',
      'toni and guy', 'wella salon',
      'pedicure', 'manicure', 'facial', 'waxing', 'threading', 'eyebrow',
      'nail art', 'nail extension',
    ],
  },

  // ── Spa (new) ─────────────────────────────────────────────────────────────
  {
    name: 'Spa',
    keywords: [
      ' spa', '/spa', 'spa payment', 'spa service',
      'body massage', 'foot massage', 'head massage', 'deep tissue massage',
      'thai massage', 'swedish massage', 'aromatherapy',
      'luxury spa', 'wellness centre', 'wellness center', 'wellness spa',
    ],
  },

  // ── GST / Taxes (new) ─────────────────────────────────────────────────────
  {
    name: 'GST / Taxes',
    keywords: [
      'cgst', 'sgst', 'igst', 'gst payment', 'gst challan',
      'income tax payment', 'income tax challan', 'tds payment', 'tds challan',
      'advance tax', 'tax payment', 'itns 280', 'itns 281',
      'professional tax', 'property tax', 'municipal tax',
    ],
  },

  // ── Household Help (new) ──────────────────────────────────────────────────
  {
    name: 'Household Help',
    keywords: [
      'maid salary', 'cook salary', 'servant salary', 'watchman salary',
      'driver salary', 'helper salary', 'housemaid salary', 'domestic help',
      'cook payment', 'maid payment', 'house maid', 'domestic worker',
    ],
  },

  // ── Gifts & Donations (new) ───────────────────────────────────────────────
  {
    name: 'Gifts & Donations',
    keywords: [
      'gift purchase', 'gifting', 'gift voucher', 'gift card',
      'donation', 'charity', 'charitable trust', 'crowdfunding',
      'temple donation', 'church donation', 'mosque donation', 'dargah',
      'ngo donation', 'give india', 'ketto', 'milaap', 'fundraiser',
      'relief fund', 'pm cares',
    ],
  },

  // ── Chit Fund (new) ───────────────────────────────────────────────────────
  {
    name: 'Chit Fund',
    keywords: [
      'chit fund', 'chit payment', 'chitty payment', 'saving chit',
      'kuri payment', 'chit installment', 'chit amount',
    ],
  },

  // ── Mobile Service (new) ──────────────────────────────────────────────────
  {
    name: 'Mobile Service',
    keywords: [
      'phone service', 'phone repair', 'mobile repair', 'mobile service',
      'screen replacement', 'display replacement', 'iphone repair',
      'samsung repair', 'oneplus service', 'mi service center',
      'phone accessories', 'mobile accessories', 'back cover', 'tempered glass',
    ],
  },

  // ── Contribution to Family (new) ──────────────────────────────────────────
  {
    name: 'Contribution to Family',
    keywords: [
      '/family/', 'family transfer', 'family support', 'family expenses',
      'sent to family', 'family money', 'wife transfer', 'husband transfer',
      'children expenses', 'family needs',
    ],
  },

  // ── Contribution to Parents (new) ─────────────────────────────────────────
  {
    name: 'Contribution to Parents',
    keywords: [
      'parents transfer', 'appa transfer', 'amma transfer',
      'father transfer', 'mother transfer', 'parents support',
      'send to parents', 'parent expenses',
    ],
  },

];

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------
async function seed() {
  console.log('Connecting to database…');

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const entry of SEEDS) {
    const { name, keywords } = entry;

    // Find existing category (case-insensitive)
    const existing = await pool.query(
      `SELECT id, name, keywords FROM categories
       WHERE user_id IS NULL AND LOWER(name) = LOWER($1)`,
      [name]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const currentKws = Array.isArray(row.keywords) ? row.keywords : [];

      // Merge: union of current + seed, preserve original case of existing entries
      const currentSet = new Set(currentKws.map((k) => k.toLowerCase().trim()));
      const toAdd = keywords.filter((k) => !currentSet.has(k.toLowerCase().trim()));

      if (toAdd.length === 0) {
        console.log(`  [=] "${row.name}" — no new keywords (${currentKws.length} existing)`);
        unchanged++;
      } else {
        const merged = [...currentKws, ...toAdd];
        await pool.query(
          `UPDATE categories SET keywords = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [merged, row.id]
        );
        console.log(`  [+] "${row.name}" — added ${toAdd.length} keyword(s) → total ${merged.length}`);
        updated++;
      }
    } else {
      // Create new global category
      await pool.query(
        `INSERT INTO categories (name, keywords, user_id, group_id)
         VALUES ($1, $2, NULL, NULL)`,
        [name, keywords]
      );
      console.log(`  [NEW] "${name}" created with ${keywords.length} keyword(s)`);
      created++;
    }
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Unchanged: ${unchanged}`);
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
