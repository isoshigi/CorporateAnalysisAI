import { describe, it, expect, vi, beforeEach } from 'vitest';
import { edinetFinancialTool } from './edinet-financial-tool';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const makeDocListResponse = (docs: object[]) => ({
  ok: true,
  json: async () => ({ results: docs }),
});

const makeEmptyDocList = () => makeDocListResponse([]);

describe('edinetFinancialTool — filing not found', () => {
  it('returns filingFound: false when no matching docs in scan window', async () => {
    // All 15 scan requests return empty
    mockFetch.mockResolvedValue(makeEmptyDocList());

    const result = await edinetFinancialTool.execute({
      corporateNumber: '1234567890123',
      filerName: '存在しない会社',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.filingFound).toBe(false);
  }, 30_000);
});

describe('edinetFinancialTool — filing found', () => {
  it('returns metadata when doc found but financial CSV fails', async () => {
    // First scan returns a matching doc
    mockFetch.mockResolvedValueOnce(makeDocListResponse([{
      docID: 'S100XXXX',
      edinetCode: 'E12345',
      filerName: 'テスト株式会社',
      docTypeCode: '120',
      periodEnd: '2024-03-31',
    }]));

    // Stage 2 returns non-OK
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await edinetFinancialTool.execute({
      corporateNumber: '1234567890123',
      filerName: 'テスト',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.success).toBe(true);
    expect(result.filingFound).toBe(true);
    expect(result.partialData).toBe(true);
    expect(result.docId).toBe('S100XXXX');
    expect(result.filerName).toBe('テスト株式会社');
    expect(result.periodEnd).toBe('2024-03-31');
    expect(result.financials).toBeUndefined();
  });

  it('handles fetch error on doc list gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await edinetFinancialTool.execute({
      corporateNumber: '1234567890123',
      filerName: 'テスト',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    // Should complete without throwing; all requests fail so filing not found
    expect(result.success).toBe(true);
    expect(result.filingFound).toBe(false);
  }, 30_000);

  it('matches filerName by partial string', async () => {
    mockFetch.mockResolvedValueOnce(makeDocListResponse([
      {
        docID: 'S100YYYY',
        edinetCode: 'E99999',
        filerName: 'トヨタ自動車株式会社',
        docTypeCode: '120',
        periodEnd: '2024-03-31',
      },
    ]));
    // Stage 2 returns error → partialData
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await edinetFinancialTool.execute({
      corporateNumber: '7120001076748',
      filerName: 'トヨタ自動車',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.filingFound).toBe(true);
    expect(result.docId).toBe('S100YYYY');
  });

  it('skips docs with wrong docTypeCode', async () => {
    mockFetch.mockResolvedValueOnce(makeDocListResponse([
      {
        docID: 'S100ZZZZ',
        edinetCode: 'E12345',
        filerName: 'テスト株式会社',
        docTypeCode: '130', // Not 有価証券報告書
        periodEnd: '2024-03-31',
      },
    ]));
    // Remaining 14 requests return empty
    mockFetch.mockResolvedValue(makeEmptyDocList());

    const result = await edinetFinancialTool.execute({
      corporateNumber: '1234567890123',
      filerName: 'テスト',
    } as Parameters<typeof edinetFinancialTool.execute>[0]);

    expect(result.filingFound).toBe(false);
  }, 30_000);
});
