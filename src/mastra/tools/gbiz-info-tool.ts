import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const GBIZINFO_API_BASE = 'https://info.gbiz.go.jp/hojin/v1/hojin';
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface GBizSubsidy {
  title?: string;
  amount?: number;
  fiscal_year?: string;
}

interface GBizCertification {
  title?: string;
  date?: string;
}

interface GBizCommendation {
  title?: string;
  date?: string;
}

interface GBizHojin {
  subsidy?: GBizSubsidy[];
  certification?: GBizCertification[];
  commendation?: GBizCommendation[];
}

interface GBizResponse {
  'hojin-infos'?: GBizHojin[];
}

const EMPTY_SUCCESS = {
  success: true as const,
  subsidyCount: 0,
  certificationCount: 0,
  awardCount: 0,
  subsidies: [] as { name?: string; amount?: number; fiscalYear?: string }[],
  certifications: [] as { name?: string; certifiedDate?: string }[],
  awards: [] as { name?: string; awardedDate?: string }[],
};

export const gBizInfoTool = createTool({
  id: 'gbiz-info',
  description: '経産省のgBizINFO APIを使用して、企業の補助金・認定・受賞情報を取得します',
  inputSchema: z.object({
    corporateNumber: z.string().describe('法人番号（13桁）'),
  }),
  outputSchema: z.object({
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
  }),
  execute: async ({ corporateNumber }) => {
    const token = process.env.GBIZINFO_API_TOKEN;
    if (!token) {
      return { success: false, error: 'GBIZINFO_API_TOKEN が設定されていません' };
    }

    const headers = {
      'X-hojinInfo-api-token': token,
      'Accept': 'application/json',
    };

    try {
      const res = await fetchWithTimeout(`${GBIZINFO_API_BASE}/${corporateNumber}`, { headers });

      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'gBizINFO APIトークンが無効または期限切れです' };
      }

      if (res.status === 404) {
        return EMPTY_SUCCESS;
      }

      if (!res.ok) {
        return { success: false, error: `gBizINFO API エラー: ${res.status}` };
      }

      const data = await res.json() as GBizResponse;
      const hojin = data['hojin-infos']?.[0];

      const subsidies = (hojin?.subsidy ?? []).map(s => ({
        name: s.title,
        amount: s.amount,
        fiscalYear: s.fiscal_year,
      }));

      const certifications = (hojin?.certification ?? []).map(c => ({
        name: c.title,
        certifiedDate: c.date,
      }));

      const awards = (hojin?.commendation ?? []).map(a => ({
        name: a.title,
        awardedDate: a.date,
      }));

      return {
        success: true,
        subsidyCount: subsidies.length,
        certificationCount: certifications.length,
        awardCount: awards.length,
        subsidies,
        certifications,
        awards,
      };
    } catch (err) {
      return { success: false, error: `APIエラー: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
