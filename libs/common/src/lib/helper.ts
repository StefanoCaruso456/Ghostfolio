import { NumberParser } from '@internationalized/number';
import { Type as ActivityType, DataSource, MarketData } from '@prisma/client';
import { Big } from 'big.js';
import { isISO4217CurrencyCode } from 'class-validator';
import {
  getDate,
  getMonth,
  getYear,
  isMatch,
  parse,
  parseISO,
  subDays
} from 'date-fns';
import {
  ca,
  de,
  es,
  fr,
  it,
  ko,
  nl,
  pl,
  pt,
  tr,
  uk,
  zhCN
} from 'date-fns/locale';
import { get, isNil, isString } from 'lodash';

import {
  DEFAULT_CURRENCY,
  DERIVED_CURRENCIES,
  ghostfolioScraperApiSymbolPrefix,
  locale
} from './config';
import { AssetProfileIdentifier, Benchmark } from './interfaces';
import { BenchmarkTrend, ColorScheme } from './types';

export const DATE_FORMAT = 'yyyy-MM-dd';
export const DATE_FORMAT_MONTHLY = 'MMMM yyyy';
export const DATE_FORMAT_YEARLY = 'yyyy';

export function calculateBenchmarkTrend({
  days,
  historicalData
}: {
  days: number;
  historicalData: MarketData[];
}): BenchmarkTrend {
  const hasEnoughData = historicalData.length >= 2 * days;

  if (!hasEnoughData) {
    return 'UNKNOWN';
  }

  const recentPeriodAverage = calculateMovingAverage({
    days,
    prices: historicalData.slice(0, days).map(({ marketPrice }) => {
      return new Big(marketPrice);
    })
  });

  const pastPeriodAverage = calculateMovingAverage({
    days,
    prices: historicalData.slice(days, 2 * days).map(({ marketPrice }) => {
      return new Big(marketPrice);
    })
  });

  if (recentPeriodAverage > pastPeriodAverage) {
    return 'UP';
  }

  if (recentPeriodAverage < pastPeriodAverage) {
    return 'DOWN';
  }

  return 'NEUTRAL';
}

export function calculateMovingAverage({
  days,
  prices
}: {
  days: number;
  prices: Big[];
}) {
  return prices
    .reduce((previous, current) => {
      return previous.add(current);
    }, new Big(0))
    .div(days)
    .toNumber();
}

export function capitalize(aString: string) {
  return aString.charAt(0).toUpperCase() + aString.slice(1).toLowerCase();
}

export function decodeDataSource(encodedDataSource: string) {
  if (encodedDataSource) {
    return Buffer.from(encodedDataSource, 'hex').toString();
  }

  return undefined;
}

export function downloadAsFile({
  content,
  contentType = 'text/plain',
  fileName,
  format
}: {
  content: unknown;
  contentType?: string;
  fileName: string;
  format: 'json' | 'string';
}) {
  const a = document.createElement('a');

  if (format === 'json') {
    content = JSON.stringify(content, undefined, '  ');
  }

  const file = new Blob([content as string], {
    type: contentType
  });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
}

export function encodeDataSource(aDataSource: DataSource) {
  if (aDataSource) {
    return Buffer.from(aDataSource, 'utf-8').toString('hex');
  }

  return undefined;
}

export function extractNumberFromString({
  locale = 'en-US',
  value
}: {
  locale?: string;
  value: string;
}): number | undefined {
  try {
    // Remove non-numeric characters (excluding international formatting characters)
    const numericValue = value.replace(/[^\d.,'’\s]/g, '');

    const parser = new NumberParser(locale);

    return parser.parse(numericValue);
  } catch {
    return undefined;
  }
}

export function getAllActivityTypes(): ActivityType[] {
  return Object.values(ActivityType);
}

export function getAssetProfileIdentifier({
  dataSource,
  symbol
}: AssetProfileIdentifier) {
  return `${dataSource}-${symbol}`;
}

export function getBackgroundColor(aColorScheme: ColorScheme) {
  return getCssVariable(
    aColorScheme === 'DARK' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? '--dark-background'
      : '--light-background'
  );
}

export function getCssVariable(aCssVariable: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(
    aCssVariable
  );
}

export function getCurrencyFromSymbol(aSymbol = '') {
  return aSymbol.replace(DEFAULT_CURRENCY, '');
}

export function getDateFnsLocale(aLanguageCode: string) {
  if (aLanguageCode === 'ca') {
    return ca;
  } else if (aLanguageCode === 'de') {
    return de;
  } else if (aLanguageCode === 'es') {
    return es;
  } else if (aLanguageCode === 'fr') {
    return fr;
  } else if (aLanguageCode === 'it') {
    return it;
  } else if (aLanguageCode === 'ko') {
    return ko;
  } else if (aLanguageCode === 'nl') {
    return nl;
  } else if (aLanguageCode === 'pl') {
    return pl;
  } else if (aLanguageCode === 'pt') {
    return pt;
  } else if (aLanguageCode === 'tr') {
    return tr;
  } else if (aLanguageCode === 'uk') {
    return uk;
  } else if (aLanguageCode === 'zh') {
    return zhCN;
  }

  return undefined;
}

export function getDateFormatString(aLocale?: string) {
  const formatObject = new Intl.DateTimeFormat(aLocale).formatToParts(
    new Date()
  );

  return formatObject
    .map(({ type, value }) => {
      switch (type) {
        case 'day':
          return 'dd';
        case 'month':
          return 'MM';
        case 'year':
          return 'yyyy';
        default:
          return value;
      }
    })
    .join('');
}

export function getDateWithTimeFormatString(aLocale?: string) {
  return `${getDateFormatString(aLocale)}, HH:mm:ss`;
}

export function getEmojiFlag(aCountryCode: string) {
  if (!aCountryCode) {
    return aCountryCode;
  }

  return aCountryCode
    .toUpperCase()
    .replace(/./g, (character) =>
      String.fromCodePoint(127397 + character.charCodeAt(0))
    );
}

export function getLocale() {
  return navigator.language ?? locale;
}

export function getLowercase(object: object, path: string) {
  const value = get(object, path);

  if (isNil(value)) {
    return '';
  }

  return isString(value) ? value.toLocaleLowerCase() : value;
}

export function getNumberFormatDecimal(aLocale?: string) {
  const formatObject = new Intl.NumberFormat(aLocale).formatToParts(9999.99);

  return formatObject.find(({ type }) => {
    return type === 'decimal';
  })?.value;
}

export function getNumberFormatGroup(aLocale = getLocale()) {
  const formatObject = new Intl.NumberFormat(aLocale, {
    useGrouping: true
  }).formatToParts(9999.99);

  return formatObject.find(({ type }) => {
    return type === 'group';
  })?.value;
}

export function getStartOfUtcDate(aDate: Date) {
  const date = new Date(aDate);
  date.setUTCHours(0, 0, 0, 0);

  return date;
}

export function getSum(aArray: Big[]) {
  if (aArray?.length > 0) {
    return aArray.reduce((a, b) => a.plus(b), new Big(0));
  }

  return new Big(0);
}

export function getTextColor(aColorScheme: ColorScheme) {
  const cssVariable = getCssVariable(
    aColorScheme === 'DARK' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? '--light-primary-text'
      : '--dark-primary-text'
  );

  const [r, g, b] = cssVariable.split(',');

  return `${r}, ${g}, ${b}`;
}

export function getToday() {
  const year = getYear(new Date());
  const month = getMonth(new Date());
  const day = getDate(new Date());

  return new Date(Date.UTC(year, month, day));
}

export function getUtc(aDateString: string) {
  const [yearString, monthString, dayString] = aDateString.split('-');

  return new Date(
    Date.UTC(
      parseInt(yearString, 10),
      parseInt(monthString, 10) - 1,
      parseInt(dayString, 10)
    )
  );
}

export function getYesterday() {
  const year = getYear(new Date());
  const month = getMonth(new Date());
  const day = getDate(new Date());

  return subDays(new Date(Date.UTC(year, month, day)), 1);
}

export function groupBy<T, K extends keyof T>(
  key: K,
  arr: T[]
): Map<T[K], T[]> {
  const map = new Map<T[K], T[]>();
  arr.forEach((t) => {
    if (!map.has(t[key])) {
      map.set(t[key], []);
    }
    map.get(t[key])!.push(t);
  });
  return map;
}

export function interpolate(template: string, context: any) {
  return template?.replace(/[$]{([^}]+)}/g, (_, objectPath) => {
    const properties = objectPath.split('.');
    return properties.reduce(
      (previous, current) => previous?.[current],
      context
    );
  });
}

export function isCurrency(aCurrency: string) {
  if (!aCurrency) {
    return false;
  }

  return isISO4217CurrencyCode(aCurrency) || isDerivedCurrency(aCurrency);
}

export function isDerivedCurrency(aCurrency: string) {
  if (aCurrency === 'USX') {
    return true;
  }

  return DERIVED_CURRENCIES.some(({ currency }) => {
    return currency === aCurrency;
  });
}

export function isRootCurrency(aCurrency: string) {
  if (aCurrency === 'USD') {
    return true;
  }

  return DERIVED_CURRENCIES.find(({ rootCurrency }) => {
    return rootCurrency === aCurrency;
  });
}

/**
 * Detects the date format used across an array of date strings.
 * Scans all values to disambiguate DD-MM-YYYY vs MM-DD-YYYY by looking
 * for values where either slot exceeds 12, making the format unambiguous.
 * Returns a format hint that parseDate() can use to avoid mis-parsing.
 */
export function detectDateFormatFromColumn(
  dateStrings: string[]
): string | undefined {
  // Only applies to dash/slash/dot-separated formats with 3 numeric parts
  const separatorPattern = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/;

  let hasFirstSlotAbove12 = false;
  let hasSecondSlotAbove12 = false;
  let detectedSeparator: string | undefined;

  for (const dateStr of dateStrings) {
    if (!dateStr) {
      continue;
    }

    const match = separatorPattern.exec(dateStr.toString().trim());

    if (!match) {
      continue;
    }

    const [, firstPart, separator, secondPart] = match;
    const first = parseInt(firstPart, 10);
    const second = parseInt(secondPart, 10);

    detectedSeparator = separator;

    if (first > 12) {
      hasFirstSlotAbove12 = true;
    }

    if (second > 12) {
      hasSecondSlotAbove12 = true;
    }
  }

  if (!detectedSeparator) {
    return undefined;
  }

  const sep = detectedSeparator;

  if (hasSecondSlotAbove12 && !hasFirstSlotAbove12) {
    // Second slot has values > 12, so it must be the day → MM-DD-YYYY
    return `MM${sep}dd${sep}yyyy`;
  }

  if (hasFirstSlotAbove12 && !hasSecondSlotAbove12) {
    // First slot has values > 12, so it must be the day → DD-MM-YYYY
    return `dd${sep}MM${sep}yyyy`;
  }

  // Ambiguous (both slots ≤ 12) or contradictory — fall back to default
  return undefined;
}

export function parseDate(
  date: string,
  detectedFormat?: string
): Date | undefined {
  if (!date) {
    return undefined;
  }

  // Transform 'yyyyMMdd' format to supported format by parse function
  if (date?.length === 8) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date);

    if (match) {
      const [, year, month, day] = match;
      date = `${year}-${month}-${day}`;
    }
  }

  // If a column-level format was detected, try it first
  if (detectedFormat && isMatch(date, detectedFormat)) {
    const parsed = parse(date, detectedFormat, new Date());

    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const dateFormat = [
    'dd-MM-yyyy',
    'dd/MM/yyyy',
    'dd.MM.yyyy',
    'yyyy-MM-dd',
    'yyyy/MM/dd',
    'yyyy.MM.dd',
    'yyyyMMdd'
  ].find((format) => {
    return isMatch(date, format) && format.length === date.length;
  });

  if (dateFormat) {
    return parse(date, dateFormat, new Date());
  }

  return parseISO(date);
}

export function parseSymbol({ dataSource, symbol }: AssetProfileIdentifier) {
  const [ticker, exchange] = symbol.split('.');

  return {
    ticker,
    exchange: exchange ?? (dataSource === 'YAHOO' ? 'US' : undefined)
  };
}

export function prettifySymbol(aSymbol: string): string {
  return aSymbol?.replace(ghostfolioScraperApiSymbolPrefix, '');
}

export function resetHours(aDate: Date) {
  const year = getYear(aDate);
  const month = getMonth(aDate);
  const day = getDate(aDate);

  return new Date(Date.UTC(year, month, day));
}

export function resolveFearAndGreedIndex(aValue: number) {
  if (aValue <= 25) {
    return { emoji: '🥵', key: 'EXTREME_FEAR', text: 'Extreme Fear' };
  } else if (aValue <= 45) {
    return { emoji: '😨', key: 'FEAR', text: 'Fear' };
  } else if (aValue <= 55) {
    return { emoji: '😐', key: 'NEUTRAL', text: 'Neutral' };
  } else if (aValue < 75) {
    return { emoji: '😜', key: 'GREED', text: 'Greed' };
  } else {
    return { emoji: '🤪', key: 'EXTREME_GREED', text: 'Extreme Greed' };
  }
}

export function resolveMarketCondition(
  aMarketCondition: Benchmark['marketCondition']
) {
  if (aMarketCondition === 'ALL_TIME_HIGH') {
    return { emoji: '🎉' };
  } else if (aMarketCondition === 'BEAR_MARKET') {
    return { emoji: '🐻' };
  } else {
    return { emoji: undefined };
  }
}
