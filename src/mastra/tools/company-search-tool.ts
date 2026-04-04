import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tavily } from '@tavily/core';

const apiKey = process.env.TAVILY_API_KEY;
if (!apiKey) {
  throw new Error(
    'Environment variable TAVILY_API_KEY is not set. Please configure it before starting the application.',
  );
}
const client = tavily({ apiKey });

export const companySearchTool = createTool({
  id: 'search-company-info',
  description: '企業名を受け取り、Web検索で企業情報（正式名称・資本金・従業員数・本社所在地・主な業務）を取得する',
  inputSchema: z.object({
    companyName: z.string().describe('調査する企業名'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    })),
  }),
  execute: async ({ companyName }) => {
    const response = await client.search(
      `${companyName} 企業情報 正式名称 資本金 従業員数 本社所在地 事業内容`,
      {
        searchDepth: 'advanced',
        maxResults: 8,
      }
    );

    return {
      results: response.results.map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.content ?? '',
      })),
    };
  },
});
