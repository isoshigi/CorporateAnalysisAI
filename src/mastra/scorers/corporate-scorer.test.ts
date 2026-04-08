import { describe, it, expect } from 'vitest';
import {
  calculateBasicTrustScore,
  calculateSocialTrustScore,
  calculateFinancialHealthScore,
  calculateFuturePotentialScore,
  aggregateScores,
} from './corporate-scorer';

describe('calculateBasicTrustScore', () => {
  it('returns 0 score when success is false', () => {
    const result = calculateBasicTrustScore({ success: false });
    expect(result.score).toBe(0);
    expect(result.riskFlags).toContain('法人番号未確認');
  });

  it('returns high score for active corporation with all fields', () => {
    const result = calculateBasicTrustScore({
      success: true,
      corporateNumber: '1234567890123',
      corporateName: 'テスト株式会社',
      address: '東京都千代田区1-1',
    });
    expect(result.score).toBe(100);
    expect(result.riskFlags).toHaveLength(0);
  });

  it('penalizes closed corporation', () => {
    const active = calculateBasicTrustScore({
      success: true,
      corporateNumber: '1234567890123',
      corporateName: 'テスト株式会社',
    });
    const closed = calculateBasicTrustScore({
      success: true,
      corporateNumber: '1234567890123',
      corporateName: 'テスト株式会社',
      closeDate: '2023-03-31',
    });
    expect(closed.score).toBeLessThan(active.score);
    expect(closed.riskFlags.some(f => f.includes('廃業'))).toBe(true);
  });

  it('score is clamped between 0 and 100', () => {
    const result = calculateBasicTrustScore({
      success: true,
      corporateNumber: '1234567890123',
      corporateName: 'テスト株式会社',
      address: '東京都',
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('calculateSocialTrustScore', () => {
  it('returns 0 when success is false', () => {
    const result = calculateSocialTrustScore({ success: false });
    expect(result.score).toBe(0);
    expect(result.riskFlags).toContain('gBizINFO取得失敗');
  });

  it('adds risk flag when no subsidies/certifications/awards', () => {
    const result = calculateSocialTrustScore({
      success: true,
      subsidyCount: 0,
      certificationCount: 0,
      awardCount: 0,
    });
    expect(result.riskFlags).toContain('補助金・認定・受賞実績なし');
  });

  it('increases score with more subsidies', () => {
    const low = calculateSocialTrustScore({ success: true, subsidyCount: 1 });
    const high = calculateSocialTrustScore({ success: true, subsidyCount: 5 });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('score is capped at 100', () => {
    const result = calculateSocialTrustScore({
      success: true,
      subsidyCount: 100,
      certificationCount: 100,
      awardCount: 100,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('calculateFinancialHealthScore', () => {
  it('returns 50 neutral when filing not found', () => {
    const result = calculateFinancialHealthScore({ success: true, filingFound: false });
    expect(result.score).toBe(50);
    expect(result.riskFlags).toContain('EDINET申告なし');
  });

  it('returns 50 neutral for partial data', () => {
    const result = calculateFinancialHealthScore({
      success: true,
      filingFound: true,
      partialData: true,
    });
    expect(result.score).toBe(50);
  });

  it('returns 0 score component for negative equity', () => {
    const result = calculateFinancialHealthScore({
      success: true,
      filingFound: true,
      financials: { netAssets: -100, assets: 1000, netSales: 500, operatingProfit: -20 },
    });
    expect(result.riskFlags).toContain('債務超過（自己資本比率マイナス）');
    expect(result.riskFlags).toContain('営業赤字');
    expect(result.score).toBe(0);
  });

  it('returns high score for healthy financials', () => {
    const result = calculateFinancialHealthScore({
      success: true,
      filingFound: true,
      financials: { netAssets: 600, assets: 1000, netSales: 500, operatingProfit: 75 },
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.riskFlags).toHaveLength(0);
  });

  it('flags operating loss', () => {
    const result = calculateFinancialHealthScore({
      success: true,
      filingFound: true,
      financials: { netAssets: 400, assets: 1000, netSales: 500, operatingProfit: -10 },
    });
    expect(result.riskFlags).toContain('営業赤字');
  });
});

describe('calculateFuturePotentialScore', () => {
  it('flags no subsidy usage', () => {
    const result = calculateFuturePotentialScore(
      { success: true, subsidyCount: 0 },
      { success: false },
    );
    expect(result.riskFlags).toContain('補助金活用なし（成長投資指標なし）');
  });

  it('increases score with subsidies', () => {
    const none = calculateFuturePotentialScore(
      { success: true, subsidyCount: 0 },
      { success: false },
    );
    const some = calculateFuturePotentialScore(
      { success: true, subsidyCount: 3 },
      { success: false },
    );
    expect(some.score).toBeGreaterThan(none.score);
  });

  it('does not flag subsidy risk when gbizInfo.success is false', () => {
    const result = calculateFuturePotentialScore(
      { success: false },
      { success: false },
    );
    expect(result.riskFlags).not.toContain('補助金活用なし（成長投資指標なし）');
  });

  it('gives higher base score for large sales', () => {
    const large = calculateFuturePotentialScore(
      { success: true, subsidyCount: 0 },
      { success: true, filingFound: true, financials: { netSales: 2_000_000_000_000 } },
    );
    const small = calculateFuturePotentialScore(
      { success: true, subsidyCount: 0 },
      { success: true, filingFound: true, financials: { netSales: 500_000_000 } },
    );
    expect(large.score).toBeGreaterThan(small.score);
  });
});

describe('aggregateScores', () => {
  const makeAxis = (score: number) => ({ score, reasoning: 'test', riskFlags: [] });

  it('applies correct weights (20/20/35/25)', () => {
    const result = aggregateScores({
      basicTrust: makeAxis(100),
      socialTrust: makeAxis(0),
      financialHealth: makeAxis(0),
      futurePotential: makeAxis(0),
    });
    expect(result.overall).toBe(20);
  });

  it('aggregates all risk flags', () => {
    const result = aggregateScores({
      basicTrust: { score: 50, reasoning: 'ok', riskFlags: ['flag1'] },
      socialTrust: { score: 50, reasoning: 'ok', riskFlags: ['flag2'] },
      financialHealth: { score: 50, reasoning: 'ok', riskFlags: [] },
      futurePotential: { score: 50, reasoning: 'ok', riskFlags: ['flag3'] },
    });
    expect(result.allRiskFlags).toEqual(['flag1', 'flag2', 'flag3']);
  });

  it('overall is between 0 and 100', () => {
    const result = aggregateScores({
      basicTrust: makeAxis(50),
      socialTrust: makeAxis(50),
      financialHealth: makeAxis(50),
      futurePotential: makeAxis(50),
    });
    expect(result.overall).toBe(50);
  });
});
