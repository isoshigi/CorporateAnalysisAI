import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { corporateSearchTool } from '../tools/corporate-search-tool';
import { gBizInfoTool } from '../tools/gbiz-info-tool';
import { edinetFinancialTool } from '../tools/edinet-financial-tool';
import {
  calculateBasicTrustScore,
  calculateSocialTrustScore,
  calculateFinancialHealthScore,
  calculateFuturePotentialScore,
  aggregateScores,
} from '../scorers/corporate-scorer';

const companyQuerySchema = z.object({
  query: z.string(),
  queryType: z.enum(['name', 'number']),
});

const resolvedCompanySchema = z.object({
  originalQuery: z.string(),
  corporateNumber: z.string().optional(),
  corporateName: z.string().optional(),
  address: z.string().optional(),
  closeDate: z.string().optional(),
  error: z.string().optional(),
});

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

const reportSchema = z.object({
  corporateName: z.string(),
  overallScore: z.number(),
  reportText: z.string(),
  riskFlags: z.array(z.string()),
});

// Step 1: Resolve corporate numbers for all companies
const resolveCompanies = createStep({
  id: 'resolve-companies',
  description: '法人番号公表サービスを使って企業名または法人番号を解決します',
  inputSchema: z.object({
    companies: z.array(companyQuerySchema).max(10),
  }),
  outputSchema: z.object({
    resolved: z.array(resolvedCompanySchema),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input data not found');

    const results = await Promise.allSettled(
      inputData.companies.map(async ({ query, queryType }) => {
        const result = await (corporateSearchTool as any).execute({ query, queryType }) as { success: boolean; corporateNumber?: string; corporateName?: string; address?: string; error?: string };
        if (!result.success) {
          return {
            originalQuery: query,
            corporateNumber: result.corporateNumber,
            corporateName: result.corporateName,
            address: result.address,
            error: result.error ?? '法人番号解決に失敗しました',
          };
        }
        return {
          originalQuery: query,
          corporateNumber: result.corporateNumber,
          corporateName: result.corporateName,
          address: result.address,
          error: undefined,
        };
      }),
    );

    const resolved = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        originalQuery: inputData.companies[i]?.query ?? '',
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });

    return { resolved };
  },
});

// Step 2: Fetch gBizInfo and EDINET data in parallel (max 2 concurrent per company)
const fetchAllData = createStep({
  id: 'fetch-all-data',
  description: 'gBizINFOとEDINETから企業データを並列取得します（同時実行数2に制限）',
  inputSchema: z.object({
    resolved: z.array(resolvedCompanySchema),
  }),
  outputSchema: z.object({
    enriched: z.array(z.object({
      resolved: resolvedCompanySchema,
      gbizInfo: gbizInfoDataSchema,
      edinet: edinetDataSchema,
    })),
  }),
  execute: async ({ inputData }) => {
    if (!inputData) throw new Error('Input data not found');

    const CONCURRENCY = 2;
    const enriched: { resolved: z.infer<typeof resolvedCompanySchema>; gbizInfo: z.infer<typeof gbizInfoDataSchema>; edinet: z.infer<typeof edinetDataSchema> }[] = [];

    // Process in batches of CONCURRENCY
    for (let i = 0; i < inputData.resolved.length; i += CONCURRENCY) {
      const batch = inputData.resolved.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (company) => {
          if (!company.corporateNumber) {
            return { resolved: company, gbizInfo: { success: false }, edinet: { success: false } };
          }

          const [gbizResult, edinetResult] = await Promise.allSettled([
            (gBizInfoTool as any).execute({ corporateNumber: company.corporateNumber }),
            (edinetFinancialTool as any).execute({
              corporateNumber: company.corporateNumber,
              filerName: company.corporateName ?? company.originalQuery,
            }),
          ]);

          return {
            resolved: company,
            gbizInfo: gbizResult.status === 'fulfilled' ? gbizResult.value : { success: false, error: String(gbizResult.reason) },
            edinet: edinetResult.status === 'fulfilled' ? edinetResult.value : { success: false, error: String(edinetResult.reason) },
          };
        }),
      );

      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          enriched.push(result.value as any);
        } else {
          // Should not happen since we handle errors inside, but be safe
          enriched.push({
            resolved: batch[idx] ?? { originalQuery: '' },
            gbizInfo: { success: false },
            edinet: { success: false },
          });
        }
      });
    }

    return { enriched };
  },
});

// Step 3: Score companies and generate reports
const scoreAndReport = createStep({
  id: 'score-and-report',
  description: 'スコア計算とテキストレポート生成を行います',
  inputSchema: z.object({
    enriched: z.array(z.object({
      resolved: resolvedCompanySchema,
      gbizInfo: gbizInfoDataSchema,
      edinet: edinetDataSchema,
    })),
  }),
  outputSchema: z.object({
    reports: z.array(reportSchema),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) throw new Error('Input data not found');

    const agent = mastra?.getAgent('corporateEvaluationAgent');

    const reports = await Promise.all(
      inputData.enriched.map(async ({ resolved, gbizInfo, edinet }) => {
        const corporateName = resolved.corporateName ?? resolved.originalQuery;

        if (!resolved.corporateNumber) {
          return {
            corporateName,
            overallScore: 0,
            reportText: `## 法人評価レポート: ${corporateName}\n\n法人番号を解決できませんでした。エラー: ${resolved.error ?? '不明'}`,
            riskFlags: ['法人番号未解決'],
          };
        }

        // Calculate scores deterministically
        const basicTrust = calculateBasicTrustScore({
          success: !!resolved.corporateNumber,
          corporateNumber: resolved.corporateNumber,
          corporateName: resolved.corporateName,
          address: resolved.address,
          closeDate: resolved.closeDate,
        });
        const socialTrust = calculateSocialTrustScore(gbizInfo);
        const financialHealth = calculateFinancialHealthScore(edinet);
        const futurePotential = calculateFuturePotentialScore(gbizInfo, edinet);
        const aggregate = aggregateScores({ basicTrust, socialTrust, financialHealth, futurePotential });

        // Generate text report via agent if available, otherwise use template
        let reportText: string;
        if (agent) {
          const prompt = `
以下の企業評価データを元に、標準フォーマットでレポートを生成してください。

企業名: ${corporateName}
法人番号: ${resolved.corporateNumber}

スコアデータ:
${JSON.stringify(aggregate, null, 2)}
`;
          const response = await agent.stream([{ role: 'user', content: prompt }]);
          let text = '';
          for await (const chunk of response.textStream) {
            text += chunk;
          }
          reportText = text;
        } else {
          reportText = generateReportTemplate(corporateName, aggregate);
        }

        return {
          corporateName,
          overallScore: aggregate.overall,
          reportText,
          riskFlags: aggregate.allRiskFlags,
        };
      }),
    );

    return { reports };
  },
});

function generateReportTemplate(
  corporateName: string,
  aggregate: ReturnType<typeof aggregateScores>,
): string {
  const stars = (score: number) => {
    const filled = Math.round(score / 20);
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
  };

  const riskSection = aggregate.allRiskFlags.length > 0
    ? aggregate.allRiskFlags.map(f => `- ${f}`).join('\n')
    : '特記すべきリスクフラグなし';

  return `## 法人評価レポート: ${corporateName}

### 総合スコア: ${aggregate.overall}/100

| 評価軸 | スコア | 判定 |
|--------|--------|------|
| 基本信頼性 | ${aggregate.basicTrust.score}/100 | ${stars(aggregate.basicTrust.score)} |
| 社会的信頼 | ${aggregate.socialTrust.score}/100 | ${stars(aggregate.socialTrust.score)} |
| 財務健全性 | ${aggregate.financialHealth.score}/100 | ${stars(aggregate.financialHealth.score)} |
| 将来性 | ${aggregate.futurePotential.score}/100 | ${stars(aggregate.futurePotential.score)} |

### 各軸の考察

**基本信頼性 (重み: 20%)**
${aggregate.basicTrust.reasoning}

**社会的信頼 (重み: 20%)**
${aggregate.socialTrust.reasoning}

**財務健全性 (重み: 35%)**
${aggregate.financialHealth.reasoning}

**将来性 (重み: 25%)**
${aggregate.futurePotential.reasoning}

### リスクフラグ
${riskSection}
`;
}

const corporateAnalysisWorkflow = createWorkflow({
  id: 'corporate-analysis-workflow',
  inputSchema: z.object({
    companies: z.array(companyQuerySchema).min(1).max(10).describe('評価対象企業リスト（最大10社）'),
  }),
  outputSchema: z.object({
    reports: z.array(reportSchema),
  }),
})
  .then(resolveCompanies)
  .then(fetchAllData)
  .then(scoreAndReport);

corporateAnalysisWorkflow.commit();

export { corporateAnalysisWorkflow };
