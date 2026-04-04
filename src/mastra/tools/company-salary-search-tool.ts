import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { tavily } from '@tavily/core';

const tavilyApiKey = process.env.TAVILY_API_KEY;

if (!tavilyApiKey) {
  throw new Error('Environment variable TAVILY_API_KEY is not set. Please configure it before using companySalarySearchTool.');
}

const client = tavily({ apiKey: tavilyApiKey });
export const companySalarySearchTool = createTool({
  id: 'search-company-salary',
  description: '企業名を受け取り、その企業の年収・月収・賞与・待遇情報をWeb検索で取得する',
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
      `${companyName} 年収 給与 月収 賞与 手当 待遇 初任給`,
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
