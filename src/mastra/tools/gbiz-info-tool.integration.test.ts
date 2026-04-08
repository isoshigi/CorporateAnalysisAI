import { describe, it, expect } from 'vitest';
import { gBizInfoTool } from './gbiz-info-tool';

const TOKEN = process.env.GBIZINFO_API_TOKEN;

describe('gBizInfoTool integration (real API)', () => {
  it('returns data for トヨタ自動車 (1180301018771)', async () => {
    if (!TOKEN) {
      console.warn('GBIZINFO_API_TOKEN not set — skipping');
      return;
    }

    const result = await gBizInfoTool.execute({
      corporateNumber: '1180301018771',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.subsidyCount).toBeGreaterThanOrEqual(0);
    expect(result.certificationCount).toBeGreaterThanOrEqual(0);
    expect(result.awardCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.subsidies)).toBe(true);
    expect(Array.isArray(result.certifications)).toBe(true);
    expect(Array.isArray(result.awards)).toBe(true);
  }, 30_000);

  it('returns empty data for non-existent corporate number (404)', async () => {
    if (!TOKEN) {
      console.warn('GBIZINFO_API_TOKEN not set — skipping');
      return;
    }

    const result = await gBizInfoTool.execute({
      corporateNumber: '0000000000000',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.subsidyCount).toBe(0);
    expect(result.certificationCount).toBe(0);
    expect(result.awardCount).toBe(0);
  }, 30_000);

  it('returns auth error when token is invalid', async () => {
    if (!TOKEN) {
      console.warn('GBIZINFO_API_TOKEN not set — skipping');
      return;
    }

    const originalToken = process.env.GBIZINFO_API_TOKEN;

    try {
      process.env.GBIZINFO_API_TOKEN = 'invalid-token-12345';

      const result = await gBizInfoTool.execute({
        corporateNumber: '1180301018771',
      } as Parameters<typeof gBizInfoTool.execute>[0]);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      process.env.GBIZINFO_API_TOKEN = originalToken;
    }
  }, 30_000);
});
