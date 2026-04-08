import { describe, it, expect, beforeAll } from 'vitest';
import { edinetFinancialTool } from './edinet-financial-tool';

const EDINET_API_BASE = 'https://api.edinet-fsa.go.jp/api/v2';
const EDINET_API_KEY = process.env.EDINET_API_KEY ?? '';

let apiReachable = false;

describe('edinetFinancialTool integration (real API)', () => {
  beforeAll(async () => {
    try {
      const url = `${EDINET_API_BASE}/documents.json?date=2025-01-08&type=2${EDINET_API_KEY ? `&Subscription-Key=${EDINET_API_KEY}` : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { apiReachable = false; return; }
      const data = await res.json() as { metadata?: { status?: number }; results?: unknown[] };
      apiReachable = (data.results?.length ?? 0) > 0;
    } catch {
      apiReachable = false;
    }
  });

  it('API returns valid JSON document list', async () => {
    const url = `${EDINET_API_BASE}/documents.json?date=2025-01-08&type=2${EDINET_API_KEY ? `&Subscription-Key=${EDINET_API_KEY}` : ''}`;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const data = await res.json() as { results?: unknown[] };
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
  }, 30_000);

  it('returns success and valid shape for トヨタ自動車', async () => {
    if (!apiReachable) { return; }
    const result = await edinetFinancialTool.execute({
      corporateNumber: '7120001076748',
      filerName: 'トヨタ自動車',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.success).toBe(true);
    if (result.filingFound) {
      expect(result.docId).toBeTruthy();
      expect(result.filerName).toBeTruthy();
      expect(result.periodEnd).toBeTruthy();
    }
  }, 120_000);

  it('returns filingFound false for non-existent company', async () => {
    const result = await edinetFinancialTool.execute({
      corporateNumber: '0000000000000',
      filerName: '存在しない架空の会社名XYZ',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.filingFound).toBe(false);
  }, 120_000);

  it('returns valid shape for ソニーグループ', async () => {
    if (!apiReachable) { return; }
    const result = await edinetFinancialTool.execute({
      corporateNumber: '5010401053466',
      filerName: 'ソニーグループ',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.success).toBe(true);
    if (result.filingFound) {
      expect(result.docId).toBeTruthy();
      expect(result.filerName).toBeTruthy();
    }
  }, 120_000);
});
