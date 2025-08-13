import { logger } from '../utils/logger.js';

export interface ExchangeRateResult {
  from: string;
  to: string;
  rate: number; // expressed as to per 1 from (e.g., 1 NEAR -> 0.001 ETH => 0.001)
  source: 'env' | 'static' | 'mock';
  timestamp: number;
}

export interface PriceOracle {
  getRate(params: { from: string; to: string }): Promise<ExchangeRateResult>;
}

/**
 * Simple price oracle service with safe fallbacks.
 * - Uses env overrides when provided (EXCHANGE_RATE_<FROM>_TO_<TO>=number)
 * - Falls back to static defaults suitable for testing
 * - Designed to be swapped with real oracles (e.g., Chainlink) in production
 */
export class PriceOracleService implements PriceOracle {
  async getRate(params: { from: string; to: string }): Promise<ExchangeRateResult> {
    const from = params.from.toUpperCase();
    const to = params.to.toUpperCase();

    // 1) ENV override: EXCHANGE_RATE_NEAR_TO_ETH=0.001
    const envKey = `EXCHANGE_RATE_${from}_TO_${to}`;
    const envVal = process.env[envKey];
    if (envVal && !Number.isNaN(Number(envVal))) {
      const rate = Number(envVal);
      logger.debug('Using exchange rate from ENV', { envKey, rate });
      return { from, to, rate, source: 'env', timestamp: Date.now() };
    }

    // 2) Static defaults (testing/dev)
    const STATIC: Record<string, Record<string, number>> = {
      NEAR: { ETH: 0.001, USD: 6 }, // 1 NEAR ≈ 0.001 ETH (example)
      ETH: { NEAR: 1000, USD: 2500 }, // 1 ETH ≈ 1000 NEAR (example)
    };

    const rate = STATIC[from]?.[to];
    if (rate) {
      return { from, to, rate, source: 'static', timestamp: Date.now() };
    }

    // 3) Final fallback
    logger.warn('Exchange rate not found; using mock 1:1 rate', { from, to });
    return { from, to, rate: 1, source: 'mock', timestamp: Date.now() };
  }
}
