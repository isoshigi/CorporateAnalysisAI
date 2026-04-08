import { describe, it, expect } from 'vitest';
import { corporateScoringTool } from './corporate-scoring-tool';

describe('corporateScoringTool', () => {
  it('returns valid output with all inputs undefined', async () => {
    const result = await corporateScoringTool.execute({
      basicInfo: undefined,
      gbizInfo: undefined,
      edinet: undefined,
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    expect(result).toMatchObject({
      overall: expect.any(Number),
      basicTrust: expect.objectContaining({ score: expect.any(Number) }),
      socialTrust: expect.objectContaining({ score: expect.any(Number) }),
      financialHealth: expect.objectContaining({ score: expect.any(Number) }),
      futurePotential: expect.objectContaining({ score: expect.any(Number) }),
      allRiskFlags: expect.any(Array),
    });
  });

  it('treats undefined basicInfo as { success: false }', async () => {
    const result = await corporateScoringTool.execute({
      basicInfo: undefined,
      gbizInfo: undefined,
      edinet: undefined,
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    expect(result.basicTrust.score).toBe(0);
    expect(result.basicTrust.riskFlags).toContain('法人番号未確認');
  });

  it('treats undefined gbizInfo as { success: false }', async () => {
    const result = await corporateScoringTool.execute({
      basicInfo: undefined,
      gbizInfo: undefined,
      edinet: undefined,
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    expect(result.socialTrust.score).toBe(0);
    expect(result.socialTrust.riskFlags).toContain('gBizINFO取得失敗');
  });

  it('treats undefined edinet as { success: false } giving neutral financial score', async () => {
    const result = await corporateScoringTool.execute({
      basicInfo: undefined,
      gbizInfo: undefined,
      edinet: undefined,
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    // calculateFinancialHealthScore returns 50 when success is false
    expect(result.financialHealth.score).toBe(50);
  });

  it('overall score is between 0 and 100 for all-undefined inputs', async () => {
    const result = await corporateScoringTool.execute({
      basicInfo: undefined,
      gbizInfo: undefined,
      edinet: undefined,
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('produces higher overall score for healthy company data', async () => {
    const undefinedResult = await corporateScoringTool.execute({
      basicInfo: undefined,
      gbizInfo: undefined,
      edinet: undefined,
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    const healthyResult = await corporateScoringTool.execute({
      basicInfo: {
        success: true,
        corporateNumber: '1234567890123',
        corporateName: 'テスト株式会社',
        address: '東京都千代田区1-1',
      },
      gbizInfo: {
        success: true,
        subsidyCount: 5,
        certificationCount: 2,
        awardCount: 1,
      },
      edinet: {
        success: true,
        filingFound: true,
        financials: {
          netAssets: 600,
          assets: 1000,
          netSales: 5000,
          operatingProfit: 500,
        },
      },
    } as Parameters<typeof corporateScoringTool.execute>[0]);

    expect(healthyResult.overall).toBeGreaterThan(undefinedResult.overall);
  });
});
