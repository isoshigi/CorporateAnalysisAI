import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  calculateBasicTrustScore,
  calculateSocialTrustScore,
  calculateFinancialHealthScore,
  calculateFuturePotentialScore,
  aggregateScores,
} from '../scorers/corporate-scorer';

const basicInfoSchema = z.object({
  success: z.boolean(),
  corporateNumber: z.string().optional(),
  corporateName: z.string().optional(),
  address: z.string().optional(),
  closeDate: z.string().optional(),
}).optional();

const gbizInfoSchema = z.object({
  success: z.boolean(),
  subsidyCount: z.number().optional(),
  certificationCount: z.number().optional(),
  awardCount: z.number().optional(),
}).optional();

const edinetSchema = z.object({
  success: z.boolean(),
  filingFound: z.boolean().optional(),
  partialData: z.boolean().optional(),
  financials: z.object({
    netAssets: z.number().optional(),
    assets: z.number().optional(),
    netSales: z.number().optional(),
    operatingProfit: z.number().optional(),
  }).optional(),
}).optional();

const scoredAxisSchema = z.object({
  score: z.number(),
  reasoning: z.string(),
  riskFlags: z.array(z.string()),
});

export const corporateScoringTool = createTool({
  id: 'corporate-scoring',
  description: '法人番号API・gBizINFO・EDINETから取得したデータを元に、企業の信頼度・将来性を決定論的にスコアリングします',
  inputSchema: z.object({
    basicInfo: basicInfoSchema,
    gbizInfo: gbizInfoSchema,
    edinet: edinetSchema,
  }),
  outputSchema: z.object({
    overall: z.number(),
    basicTrust: scoredAxisSchema,
    socialTrust: scoredAxisSchema,
    financialHealth: scoredAxisSchema,
    futurePotential: scoredAxisSchema,
    allRiskFlags: z.array(z.string()),
  }),
  execute: async ({ basicInfo, gbizInfo, edinet }) => {
    const basicTrust = calculateBasicTrustScore(
      basicInfo ?? { success: false },
    );

    const socialTrust = calculateSocialTrustScore(
      gbizInfo ?? { success: false },
    );

    const financialHealth = calculateFinancialHealthScore(
      edinet ?? { success: false },
    );

    const futurePotential = calculateFuturePotentialScore(
      gbizInfo ?? { success: false },
      edinet ?? { success: false },
    );

    return aggregateScores({ basicTrust, socialTrust, financialHealth, futurePotential });
  },
});
