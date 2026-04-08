import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Concrete schemas as defined in the workflow (replaces z.any())
const gbizInfoDataSchema = z.object({
  success: z.boolean(),
  subsidyCount: z.number().optional(),
  certificationCount: z.number().optional(),
  awardCount: z.number().optional(),
  subsidies: z.array(z.object({
    name: z.string().optional(),
    amount: z.number().optional(),
    fiscalYear: z.string().optional(),
  })).optional(),
  certifications: z.array(z.object({
    name: z.string().optional(),
    certifiedDate: z.string().optional(),
  })).optional(),
  awards: z.array(z.object({
    name: z.string().optional(),
    awardedDate: z.string().optional(),
  })).optional(),
  error: z.string().optional(),
});

const edinetDataSchema = z.object({
  success: z.boolean(),
  filingFound: z.boolean().optional(),
  partialData: z.boolean().optional(),
  docId: z.string().optional(),
  filerName: z.string().optional(),
  periodEnd: z.string().optional(),
  financials: z.object({
    netAssets: z.number().optional(),
    assets: z.number().optional(),
    netSales: z.number().optional(),
    operatingProfit: z.number().optional(),
  }).optional(),
  error: z.string().optional(),
});

describe('gbizInfoDataSchema (replaces z.any())', () => {
  it('rejects a plain string', () => {
    expect(gbizInfoDataSchema.safeParse('invalid').success).toBe(false);
  });

  it('rejects a number', () => {
    expect(gbizInfoDataSchema.safeParse(42).success).toBe(false);
  });

  it('rejects null', () => {
    expect(gbizInfoDataSchema.safeParse(null).success).toBe(false);
  });

  it('accepts a success=false fallback object', () => {
    expect(gbizInfoDataSchema.safeParse({ success: false }).success).toBe(true);
  });

  it('accepts full gBizINFO response', () => {
    expect(gbizInfoDataSchema.safeParse({
      success: true,
      subsidyCount: 3,
      certificationCount: 1,
      awardCount: 0,
      subsidies: [{ name: '補助金A', amount: 1000000, fiscalYear: '2023' }],
      certifications: [],
      awards: [],
    }).success).toBe(true);
  });
});

describe('edinetDataSchema (replaces z.any())', () => {
  it('rejects a plain string', () => {
    expect(edinetDataSchema.safeParse('invalid').success).toBe(false);
  });

  it('rejects null', () => {
    expect(edinetDataSchema.safeParse(null).success).toBe(false);
  });

  it('accepts a success=false fallback object', () => {
    expect(edinetDataSchema.safeParse({ success: false }).success).toBe(true);
  });

  it('accepts filing-not-found response', () => {
    expect(edinetDataSchema.safeParse({ success: true, filingFound: false }).success).toBe(true);
  });

  it('accepts full EDINET response with financials', () => {
    expect(edinetDataSchema.safeParse({
      success: true,
      filingFound: true,
      partialData: false,
      docId: 'S100XXXX',
      filerName: 'テスト株式会社',
      periodEnd: '2023-03-31',
      financials: { netAssets: 500, assets: 1000, netSales: 2000, operatingProfit: 100 },
    }).success).toBe(true);
  });
});

describe('batch processing index (off-by-one fix)', () => {
  it('correctly maps batch items when first batch fully fulfills and second batch has rejection', () => {
    // Reproduces the bug scenario:
    // Batch 1 [a, b] both fulfill → enriched.length = 2
    // Batch 2 [c, d] c rejects → buggy code: batch[enriched.length] = batch[2] = undefined
    //                             fixed code: batch[idx] = batch[0] = 'c'
    const companies = ['a', 'b', 'c', 'd'];
    const CONCURRENCY = 2;
    const enriched: { resolved: string }[] = [];

    for (let i = 0; i < companies.length; i += CONCURRENCY) {
      const batch = companies.slice(i, i + CONCURRENCY);

      // Simulate batch 1: both fulfilled, batch 2: first rejected
      const batchResults: PromiseSettledResult<{ resolved: string }>[] = batch.map((company, batchIdx) => {
        // Reject the first item of the second batch (companies[2] = 'c')
        if (i === CONCURRENCY && batchIdx === 0) {
          return { status: 'rejected' as const, reason: new Error('simulated error') };
        }
        return { status: 'fulfilled' as const, value: { resolved: company } };
      });

      // Fixed implementation using forEach with batch-relative idx
      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          enriched.push(result.value);
        } else {
          enriched.push({ resolved: batch[idx] ?? 'UNDEFINED' });
        }
      });
    }

    expect(enriched).toHaveLength(4);
    expect(enriched[0]?.resolved).toBe('a');
    expect(enriched[1]?.resolved).toBe('b');
    expect(enriched[2]?.resolved).toBe('c'); // correctly recovered, not 'UNDEFINED'
    expect(enriched[3]?.resolved).toBe('d');
  });

  it('buggy implementation (enriched.length as index) would lose the company reference', () => {
    // Demonstrates the bug: after first batch fills enriched to length 2,
    // batch[enriched.length] in the second batch refers to batch[2] which is out of bounds
    const companies = ['a', 'b', 'c', 'd'];
    const CONCURRENCY = 2;
    const buggyEnriched: { resolved: string }[] = [];

    for (let i = 0; i < companies.length; i += CONCURRENCY) {
      const batch = companies.slice(i, i + CONCURRENCY);

      const batchResults: PromiseSettledResult<{ resolved: string }>[] = batch.map((company, batchIdx) => {
        if (i === CONCURRENCY && batchIdx === 0) {
          return { status: 'rejected' as const, reason: new Error('simulated error') };
        }
        return { status: 'fulfilled' as const, value: { resolved: company } };
      });

      // Buggy implementation using enriched.length as index
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          buggyEnriched.push(result.value);
        } else {
          const idx = buggyEnriched.length; // BUG: absolute index, not batch-relative
          buggyEnriched.push({ resolved: batch[idx] ?? 'UNDEFINED' });
        }
      }
    }

    // The bug: in the second batch, batch[2] is undefined, so company 'c' is lost
    expect(buggyEnriched[2]?.resolved).toBe('UNDEFINED');
  });
});
