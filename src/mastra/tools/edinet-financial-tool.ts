import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const inflateRawAsync = promisify(inflateRaw);

const EDINET_API_BASE = 'https://api.edinet-fsa.go.jp/api/v2';
const EDINET_API_KEY = process.env.EDINET_API_KEY ?? '';
const MAX_SCAN_REQUESTS = 15;
const SCAN_INTERVAL_DAYS = 7;
const REQUEST_TIMEOUT_MS = 10_000;

function buildApiUrl(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return EDINET_API_KEY
    ? `${EDINET_API_BASE}${path}${separator}Subscription-Key=${EDINET_API_KEY}`
    : `${EDINET_API_BASE}${path}`;
}

interface EdinetDocInfo {
  docID: string;
  edinetCode: string;
  filerName: string;
  docTypeCode: string;
  periodEnd: string;
}

interface EdinetDocListResponse {
  results?: EdinetDocInfo[];
}

/**
 * Parse a ZIP buffer and return the contents of the first CSV file found.
 * Uses minimal ZIP format parsing with Node.js built-in zlib.
 */
async function extractFirstCsvFromZip(buffer: Buffer): Promise<string> {
  let offset = 0;

  while (offset < buffer.length - 30) {
    // Local file header signature: PK\x03\x04
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + fileNameLen + extraLen;
    const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLen).toString('utf-8');

    if (fileName.toLowerCase().endsWith('.csv')) {
      const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize);
      if (compression === 0) {
        return compressedData.toString('utf-8');
      } else if (compression === 8) {
        const decompressed = await inflateRawAsync(compressedData);
        return decompressed.toString('utf-8');
      }
    }

    offset = dataOffset + compressedSize;
  }

  throw new Error('ZIPファイル内にCSVが見つかりませんでした');
}

interface Financials {
  netAssets?: number;
  assets?: number;
  netSales?: number;
  operatingProfit?: number;
}

/**
 * Parse EDINET financial summary CSV.
 * Rows contain XBRL element name, context, value, unit.
 * Prefer consolidated (連結) over non-consolidated (個別).
 */
function parseFinancialCsv(csv: string): Financials {
  const financials: Financials = {};

  // XBRL concept name patterns (J-GAAP, prefer consolidated)
  const targetConcepts: Record<keyof Financials, string[]> = {
    netAssets: [
      'NetAssets',
      'jppfs_cor:NetAssets',
      'NetAssetsConsolidated',
    ],
    assets: [
      'Assets',
      'jppfs_cor:Assets',
      'TotalAssets',
    ],
    netSales: [
      'NetSales',
      'jppfs_cor:NetSales',
      'NetSalesAndOperatingRevenues',
      'Revenues',
    ],
    operatingProfit: [
      'OperatingProfit',
      'jppfs_cor:OperatingProfit',
      'OperatingIncome',
    ],
  };

  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);

  // Track consolidated vs non-consolidated hits
  const consolidated: Partial<Financials> = {};
  const nonConsolidated: Partial<Financials> = {};

  for (const line of lines) {
    // CSV may use comma or tab as delimiter
    const cols = line.includes('\t') ? line.split('\t') : line.split(',');
    if (cols.length < 3) continue;

    const elementName = (cols[0] ?? '').trim().replace(/^"(.*)"$/, '$1');
    const contextRef = (cols[1] ?? '').trim().replace(/^"(.*)"$/, '$1');
    const valueStr = (cols[2] ?? '').trim().replace(/^"(.*)"$/, '$1');

    const value = parseFloat(valueStr.replace(/,/g, ''));
    if (isNaN(value)) continue;

    const isConsolidated = contextRef.includes('Consolidated') ||
      contextRef.includes('consolidated') ||
      contextRef.toLowerCase().includes('consolidated');

    for (const [field, patterns] of Object.entries(targetConcepts) as [keyof Financials, string[]][]) {
      if (patterns.some(p => elementName.includes(p))) {
        if (isConsolidated) {
          if (consolidated[field] === undefined) consolidated[field] = value;
        } else {
          if (nonConsolidated[field] === undefined) nonConsolidated[field] = value;
        }
        break;
      }
    }
  }

  // Prefer consolidated data
  for (const field of ['netAssets', 'assets', 'netSales', 'operatingProfit'] as (keyof Financials)[]) {
    financials[field] = consolidated[field] ?? nonConsolidated[field];
  }

  return financials;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] as string;
}

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const edinetFinancialTool = createTool({
  id: 'edinet-financial',
  description: 'EDINET APIを使用して、上場企業の有価証券報告書から財務情報（自己資本比率・営業利益率など）を取得します',
  inputSchema: z.object({
    corporateNumber: z.string().describe('法人番号（13桁）'),
    filerName: z.string().describe('提出者名（企業名）'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    filingFound: z.boolean(),
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
  }),
  execute: async ({ filerName }) => {
    // Stage 1: Scan document list by date (weekly batches, max 15 requests)
    const today = new Date();
    let matchedDoc: EdinetDocInfo | null = null;

    for (let i = 0; i < MAX_SCAN_REQUESTS; i++) {
      const scanDate = new Date(today);
      scanDate.setDate(today.getDate() - i * SCAN_INTERVAL_DAYS);
      const dateStr = formatDate(scanDate);

      let res: Response;
      try {
        res = await fetchWithTimeout(
          buildApiUrl(`/documents.json?date=${dateStr}&type=2`),
        );
      } catch {
        continue;
      }

      if (!res.ok) continue;

      let data: EdinetDocListResponse;
      try {
        data = await res.json() as EdinetDocListResponse;
      } catch {
        continue;
      }

      const results = data.results ?? [];

      const found = results.find(doc =>
        doc.docTypeCode === '120' &&
        doc.filerName.includes(filerName.replace(/株式会社|合同会社|有限会社/g, '').trim()),
      );

      if (found) {
        matchedDoc = found;
        break;
      }
    }

    if (!matchedDoc) {
      return {
        success: true,
        filingFound: false,
      };
    }

    // Stage 2: Fetch financial summary CSV (type=4, returns ZIP)
    let zipBuffer: Buffer;
    try {
      const res = await fetchWithTimeout(
        buildApiUrl(`/documents/${matchedDoc.docID}?type=4`),
      );

      if (!res.ok) {
        return {
          success: true,
          filingFound: true,
          partialData: true,
          docId: matchedDoc.docID,
          filerName: matchedDoc.filerName,
          periodEnd: matchedDoc.periodEnd,
        };
      }

      const arrayBuffer = await res.arrayBuffer();
      zipBuffer = Buffer.from(arrayBuffer);
    } catch {
      return {
        success: true,
        filingFound: true,
        partialData: true,
        docId: matchedDoc.docID,
        filerName: matchedDoc.filerName,
        periodEnd: matchedDoc.periodEnd,
      };
    }

    // Parse ZIP and extract CSV
    let csv: string;
    try {
      csv = await extractFirstCsvFromZip(zipBuffer);
    } catch {
      return {
        success: true,
        filingFound: true,
        partialData: true,
        docId: matchedDoc.docID,
        filerName: matchedDoc.filerName,
        periodEnd: matchedDoc.periodEnd,
      };
    }

    // Parse financial data from CSV
    let financials: Financials;
    try {
      financials = parseFinancialCsv(csv);
    } catch {
      return {
        success: true,
        filingFound: true,
        partialData: true,
        docId: matchedDoc.docID,
        filerName: matchedDoc.filerName,
        periodEnd: matchedDoc.periodEnd,
      };
    }

    const hasAnyData = Object.values(financials).some(v => v !== undefined);

    return {
      success: true,
      filingFound: true,
      partialData: !hasAnyData,
      docId: matchedDoc.docID,
      filerName: matchedDoc.filerName,
      periodEnd: matchedDoc.periodEnd,
      financials: hasAnyData ? financials : undefined,
    };
  },
});
