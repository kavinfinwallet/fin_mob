/**
 * Common currencies: code, name, symbol.
 * Used for customer currency dropdown and formatting.
 * Default: INR (Indian Rupee, ₹).
 */
export const CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
  { code: 'BGD', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
  { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв' },
  { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: '﷼' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD' },
  { code: 'LBP', name: 'Lebanese Pound', symbol: 'L£' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U' },
  { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs' },
  { code: 'PYG', name: 'Paraguayan Guaraní', symbol: '₲' },
  { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
];

/** Default currency when customer has none set */
export const DEFAULT_CURRENCY = { code: 'INR', name: 'Indian Rupee', symbol: '₹' };

/** Get currency by code */
export function getCurrencyByCode(code) {
  if (!code) return DEFAULT_CURRENCY;
  return CURRENCIES.find((c) => c.code === code) || { code: code || 'INR', name: code || 'INR', symbol: '₹' };
}

/** Get currency symbol for a customer (from customer object or default) */
export function getCurrencySymbol(customer) {
  if (customer?.currency_symbol) return customer.currency_symbol;
  if (customer?.currency_code) {
    const c = getCurrencyByCode(customer.currency_code);
    return c.symbol;
  }
  return DEFAULT_CURRENCY.symbol;
}

/** Get currency code for a customer */
export function getCurrencyCode(customer) {
  if (customer?.currency_code) return customer.currency_code;
  return DEFAULT_CURRENCY.code;
}

/**
 * Format amount with customer's currency (symbol + number).
 * Use for display across the app when a customer is selected.
 * @param {number} amount - numeric amount
 * @param {object} customer - customer with currency_code / currency_symbol (optional)
 * @param {{ compact?: boolean }} options - compact for K/M shorthand
 */
export function formatCurrency(amount, customer, options = {}) {
  const num = Number(amount);
  if (Number.isNaN(num)) return '—';
  const symbol = getCurrencySymbol(customer);
  const code = getCurrencyCode(customer);
  const abs = Math.abs(num);
  if (options.compact) {
    if (abs >= 1_000_000) return `${symbol}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${symbol}${(abs / 1_000).toFixed(1)}K`;
  }
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${symbol} ${abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
