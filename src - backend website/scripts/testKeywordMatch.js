/**
 * Quick sanity test of keyword matching against real narrations.
 * Run: node scripts/testKeywordMatch.js
 */
const { loadRules, matchDescriptionWithRules } = require('../utils/keywordCategorizer');

const TEST_CASES = [
  { desc: 'UPI/ 404415446936/ From:sankara.kmr@ybl/ To:REDBUS2BUS@ybl/ Payment for 1469608346', expected: 'Travel' },
  { desc: 'ACH D- BD-MF UTILITIES LUMP-TJAC30281982', expected: 'Mutual Funds' },
  { desc: 'UPI-GOOGLE INDIA DIGITAL-GPAYRECHARGE@OK PAYAXIS-UTIB0000553-115752017581-UPI', expected: 'Mobile Recharge' },
  { desc: 'IB BILLPAY DR-HDFCVE-489377XXXXXX9749', expected: 'Credit Card' },
  { desc: 'IB BILLPAY DR-HDFC5X-653029XXXXXX5772', expected: 'Credit Card' },
  { desc: 'UPI-SUSHRUSHAH PHARMACY-MSWIPE.1400021424000251@INDIANBK-IDIB000M002-117550124489-UPI', expected: 'Medical' },
  { desc: '080126I049908515 DPO2600999694749 CGST', expected: 'GST / Taxes' },
  { desc: 'NWD-416021XXXXXX0710-SPCNU855-CHENNAI', expected: 'ATM Withdrawal' },
  { desc: 'ATW-416021XXXXXX0710-P3ENCX36-CHENNAI', expected: 'ATM Withdrawal' },
  { desc: 'UPIAR/768668689051/DR/URBAN CO/HDFC/urbancompanyli', expected: 'Home Maintenance' },
  { desc: 'UPIOUT/601011011460/indianrailwayca252644.rz/4112', expected: 'Travel' },
  { desc: 'UPIOUT/601611449688/indianrailwayca252644.rz/4112', expected: 'Travel' },
  { desc: 'UPIOUT/638273188851/apollopharmacyoffline@ax/5912', expected: 'Medical' },
  { desc: 'UPIOUT/617950030036/jupiterfppi@icici/Sent v/6540', expected: 'Shares' },
  { desc: 'UPI-CENNEY HOTELS PVT LT-VYAPAR.17370561 0047@HDFCBANK-HDFC0MERUPI-333517272875-U PI', expected: 'Dining / Food Delivery' },
  { desc: 'UPI-SAMSUNG BILL CICI-ICIC0DC0099-215915272995-PAYMENT FO', expected: null },   // bill but no credit card kw match – goes to Gemini
  { desc: 'UPI-MR ASHOK KUMAR R-Q029478854@YBL-YESB 0YBLUPI-745163533405-MILK CBE', expected: null }, // "milk" not in keywords directly
  { desc: 'UPI-HOTEL SARAN-HOTELSARAN@SBI-SBIN00165 49-819886590046-PALANI ROOMS', expected: 'Rent / Home EMI' },
  { desc: 'UPI-MF UTILITIES-MFUTILITIESMF.BD@ICICI- ICIC0DC0099-525164868156-COLLECT-PAY-REQUES', expected: 'Mutual Funds' },
  { desc: 'UPI-VELAVANMEDICAL-BHARATPE.90069429357@ RATPE ME', expected: 'Medical' },
  { desc: 'UPI-NEW VISHAKA MOTORS-Q097620738@YBL-YE SB0YBLUPI-264913230316-BIKE SERVICE', expected: 'Vehicle Maintenance' },
  { desc: 'UPI-SHA ALI S-SHAALI@TMB-TMBL0000041-957 109270106-DOCTOR', expected: 'Medical' },
  { desc: 'UPI-ORIGINAL HOMOEO MEDI-PAYTM-62288021@ PTYS-YESB0PTMUPI-615419480136-MEDICINE', expected: 'Medical' },
  { desc: 'UPI-RAJENDRAN AXIS-UBIN0549398-116733066276-SAVING CHI TU KASU', expected: 'Chit Fund' },
  { desc: 'UPI-MEGALA G-M05971236@OKSBI-CNRB0000033 -116751128537-COOK SALARY', expected: 'Household Help' },
  { desc: 'UPI-KAMATCHI-KAMACHI12497-3@OKAXIS-KVBL0 001616-116847587365-MEDITATION CLASS', expected: 'Health & Fitness' },
  { desc: 'UPI-KARTHICKPANDI B-9566418246@PTAXIS-TM BL0000327-116873597985-GIFT', expected: 'Gifts & Donations' },
  { desc: 'UPI-K SHANKER-KKSMOBILESERVICE-1@OKAXIS- DBSS0IN0483-117011189120-PHONE SERVICE', expected: 'Mobile Service' },
  { desc: 'UPI-MSVINITAS ENTERPRISE-IBKPOS.EP089846 @ICICI-ICIC0000004-117020883780-HAIR CUT', expected: 'Self Care' },
  { desc: 'UPI-SUVAI BIRIYANI-STATICBP.A00000000001 9552@AXISBANK-UTIB0000006-117099861051-D INNER', expected: 'Dining / Food Delivery' },
  { desc: 'UPI-MSVINITAS ENTERPRISE-IBKPOS.EP089846 @ICICI-ICIC0000004-116601882187-SPA', expected: 'Spa' },
  { desc: 'UPI/Ms Vasanth/vasanthisuresh/family/CITY UNION/600592016889/', expected: 'Contribution to Family' },
  { desc: 'MOBFT/HAROON HAMEED M/Family/161980412278', expected: 'Contribution to Family' },
];

(async () => {
  const rules = await loadRules();
  console.log(`Loaded ${rules.length} keyword entries from DB\n`);

  let pass = 0, fail = 0, noExpect = 0;
  for (const tc of TEST_CASES) {
    const result = matchDescriptionWithRules(tc.desc, rules);
    const got = result ? result.category_name : null;

    if (tc.expected === null) {
      noExpect++;
      console.log(`  [SKIP] ${got ? `→ matched "${got}"` : '→ no match (→ Gemini)'}`);
      console.log(`         ${tc.desc.slice(0, 80)}`);
    } else if (got === tc.expected) {
      pass++;
      console.log(`  [✓] "${got}" ← ${tc.desc.slice(0, 70)}`);
    } else {
      fail++;
      console.log(`  [✗] Expected "${tc.expected}", got "${got}"`);
      console.log(`      ${tc.desc.slice(0, 80)}`);
    }
  }

  console.log(`\nResults: ${pass} pass, ${fail} fail, ${noExpect} skipped (no expected)`);
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
