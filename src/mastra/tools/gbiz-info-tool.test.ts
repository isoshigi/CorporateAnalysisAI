import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gBizInfoTool } from './gbiz-info-tool';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('GBIZINFO_API_TOKEN', 'test-token');
});

describe('gBizInfoTool', () => {
  it('returns error when API token is missing', async () => {
    vi.stubEnv('GBIZINFO_API_TOKEN', '');
    const result = await gBizInfoTool.execute({
      corporateNumber: '1234567890123',
    } as Parameters<typeof gBizInfoTool.execute>[0]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('GBIZINFO_API_TOKEN');
  });

  it('returns zero counts on 404 (not registered in gBizINFO)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await gBizInfoTool.execute({
      corporateNumber: '9999999999999',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.subsidyCount).toBe(0);
    expect(result.certificationCount).toBe(0);
    expect(result.awardCount).toBe(0);
    expect(result.subsidies).toHaveLength(0);
  });

  it('returns auth error on 401', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await gBizInfoTool.execute({
      corporateNumber: '1234567890123',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('無効');
  });

  it('returns auth error on 403', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    const result = await gBizInfoTool.execute({
      corporateNumber: '1234567890123',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('無効');
  });

  it('parses subsidy, certification, and award data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        'hojin-infos': [{
          subsidy: [
            { title: '補助金A', amount: 1000000, fiscal_year: '2022' },
            { title: '補助金B', amount: 500000, fiscal_year: '2023' },
          ],
          certification: [
            { title: '認定A', date: '2021-04-01' },
          ],
          commendation: [
            { title: '受賞A', date: '2020-12-01' },
          ],
        }],
      }),
    });

    const result = await gBizInfoTool.execute({
      corporateNumber: '1234567890123',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.subsidyCount).toBe(2);
    expect(result.certificationCount).toBe(1);
    expect(result.awardCount).toBe(1);
    expect(result.subsidies?.[0]?.name).toBe('補助金A');
    expect(result.certifications?.[0]?.name).toBe('認定A');
    expect(result.awards?.[0]?.name).toBe('受賞A');
  });

  it('handles empty hojin_info gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ 'hojin-infos': [] }),
    });

    const result = await gBizInfoTool.execute({
      corporateNumber: '1234567890123',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.subsidyCount).toBe(0);
  });

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Timeout'));

    const result = await gBizInfoTool.execute({
      corporateNumber: '1234567890123',
    } as Parameters<typeof gBizInfoTool.execute>[0]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');
  });
});
