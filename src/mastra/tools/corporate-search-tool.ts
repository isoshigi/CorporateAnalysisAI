import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const GBIZINFO_API_BASE = 'https://info.gbiz.go.jp/hojin/v2/hojin';
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

interface GBizHojinInfo {
  corporate_number?: string;
  name?: string;
  location?: string;
  status?: string;
}

interface GBizSearchResponse {
  errors?: Array<{ item?: string; message?: string }>;
  'hojin-infos'?: GBizHojinInfo[];
  id?: string;
  message?: string;
}

export const corporateSearchTool = createTool({
  id: 'corporate-search',
  description: 'gBizINFO APIを使用して、法人名または法人番号から企業情報を検索します',
  inputSchema: z.object({
    query: z.string().describe('法人名または法人番号'),
    queryType: z.enum(['name', 'number']).describe('検索タイプ: name=法人名で部分一致検索, number=法人番号で完全一致検索'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    corporateNumber: z.string().optional(),
    corporateName: z.string().optional(),
    address: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query, queryType }) => {
    const token = process.env.GBIZINFO_API_TOKEN;
    if (!token) {
      return { success: false, error: 'GBIZINFO_API_TOKEN が設定されていません' };
    }

    const params = new URLSearchParams();
    if (queryType === 'name') {
      params.set('name', query);
    } else {
      params.set('corporate_number', query);
    }
    params.set('limit', '1');
    params.set('metadata_flg', 'false');

    try {
      const res = await fetchWithTimeout(
        `${GBIZINFO_API_BASE}?${params.toString()}`,
        {
          headers: {
            'X-hojinInfo-api-token': token,
            'Accept': 'application/json',
          },
        },
      );

      if (res.status === 401 || res.status === 403) {
        return { success: false, error: 'gBizINFO APIトークンが無効または期限切れです' };
      }

      if (!res.ok) {
        return { success: false, error: `gBizINFO API エラー: ${res.status}` };
      }

      const data = await res.json() as GBizSearchResponse;

      if (data.errors && data.errors.length > 0) {
        return { success: false, error: data.errors.map(e => e.message).join(', ') };
      }

      const hojin = data['hojin-infos']?.[0];
      if (!hojin) {
        return { success: false, error: '該当する法人情報が見つかりませんでした' };
      }

      return {
        success: true,
        corporateNumber: hojin.corporate_number?.trim(),
        corporateName: hojin.name?.trim(),
        address: hojin.location?.trim(),
      };
    } catch (err) {
      return { success: false, error: `APIエラー: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});