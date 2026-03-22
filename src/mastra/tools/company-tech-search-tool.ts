import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tavily } from '@tavily/core';

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const companyTechSearchTool = createTool({
  id: 'search-company-tech',
  description: '企業名を受け取り、その企業の採用技術スタック・使用技術・求めるスキルをWeb検索で取得する',
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
      `${companyName} 採用 使用技術 技術スタック 開発環境 プログラミング言語 フレームワーク`,
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
