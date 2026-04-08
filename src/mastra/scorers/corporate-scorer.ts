export interface ScoredAxis {
  score: number;
  reasoning: string;
  riskFlags: string[];
}

export interface AggregateScore {
  overall: number;
  basicTrust: ScoredAxis;
  socialTrust: ScoredAxis;
  financialHealth: ScoredAxis;
  futurePotential: ScoredAxis;
  allRiskFlags: string[];
}

export function calculateBasicTrustScore(basicInfo: {
  success: boolean;
  corporateNumber?: string;
  corporateName?: string;
  address?: string;
  closeDate?: string;
}): ScoredAxis {
  const riskFlags: string[] = [];
  const reasoning: string[] = [];

  if (!basicInfo.success || !basicInfo.corporateNumber) {
    return {
      score: 0,
      reasoning: '法人番号が確認できませんでした',
      riskFlags: ['法人番号未確認'],
    };
  }

  let score = 50;
  reasoning.push('法人番号が確認されました');

  if (basicInfo.corporateName) {
    score += 20;
    reasoning.push('法人名が登録されています');
  }

  if (basicInfo.address) {
    score += 20;
    reasoning.push('住所が登録されています');
  }

  if (basicInfo.closeDate) {
    score = Math.max(0, score - 60);
    riskFlags.push(`廃業日: ${basicInfo.closeDate}`);
    reasoning.push('廃業済みの法人です');
  } else {
    score += 10;
    reasoning.push('活動中の法人です');
  }

  return {
    score: Math.min(100, score),
    reasoning: reasoning.join('。'),
    riskFlags,
  };
}

export function calculateSocialTrustScore(gbizInfo: {
  success: boolean;
  subsidyCount?: number;
  certificationCount?: number;
  awardCount?: number;
}): ScoredAxis {
  const riskFlags: string[] = [];
  const reasoning: string[] = [];

  if (!gbizInfo.success) {
    return {
      score: 0,
      reasoning: 'gBizINFO データの取得に失敗しました',
      riskFlags: ['gBizINFO取得失敗'],
    };
  }

  const subsidyCount = gbizInfo.subsidyCount ?? 0;
  const certificationCount = gbizInfo.certificationCount ?? 0;
  const awardCount = gbizInfo.awardCount ?? 0;

  let score = 40; // base score

  const subsidyScore = Math.min(25, subsidyCount * 5);
  score += subsidyScore;
  reasoning.push(`補助金受給実績: ${subsidyCount}件`);

  const certScore = Math.min(25, certificationCount * 8);
  score += certScore;
  reasoning.push(`認定実績: ${certificationCount}件`);

  const awardScore = Math.min(10, awardCount * 5);
  score += awardScore;
  reasoning.push(`受賞実績: ${awardCount}件`);

  if (subsidyCount === 0 && certificationCount === 0 && awardCount === 0) {
    riskFlags.push('補助金・認定・受賞実績なし');
  }

  return {
    score: Math.min(100, score),
    reasoning: reasoning.join('。'),
    riskFlags,
  };
}

export function calculateFinancialHealthScore(edinet: {
  success: boolean;
  filingFound?: boolean;
  partialData?: boolean;
  financials?: {
    netAssets?: number;
    assets?: number;
    netSales?: number;
    operatingProfit?: number;
  };
}): ScoredAxis {
  const riskFlags: string[] = [];
  const reasoning: string[] = [];

  if (!edinet.success || !edinet.filingFound) {
    return {
      score: 50,
      reasoning: '有価証券報告書が見つかりませんでした（非上場企業の可能性）',
      riskFlags: ['EDINET申告なし'],
    };
  }

  if (edinet.partialData || !edinet.financials) {
    return {
      score: 50,
      reasoning: '財務データの一部のみ取得できました',
      riskFlags: ['財務データ不完全'],
    };
  }

  const { netAssets, assets, netSales, operatingProfit } = edinet.financials;
  let score = 0;
  let factorCount = 0;

  // Equity ratio: netAssets / assets (up to 50 points)
  if (netAssets !== undefined && assets !== undefined && assets > 0) {
    const equityRatio = netAssets / assets;
    reasoning.push(`自己資本比率: ${(equityRatio * 100).toFixed(1)}%`);

    if (equityRatio < 0) {
      score += 0;
      riskFlags.push('債務超過（自己資本比率マイナス）');
    } else if (equityRatio < 0.1) {
      score += 10;
      riskFlags.push('自己資本比率が非常に低い（10%未満）');
    } else if (equityRatio < 0.2) {
      score += 25;
      riskFlags.push('自己資本比率が低い（20%未満）');
    } else if (equityRatio < 0.4) {
      score += 40;
    } else {
      score += 50;
    }
    factorCount++;
  }

  // Operating profit margin: operatingProfit / netSales (up to 50 points)
  if (operatingProfit !== undefined && netSales !== undefined && netSales > 0) {
    const operatingMargin = operatingProfit / netSales;
    reasoning.push(`営業利益率: ${(operatingMargin * 100).toFixed(1)}%`);

    if (operatingMargin < 0) {
      score += 0;
      riskFlags.push('営業赤字');
    } else if (operatingMargin < 0.02) {
      score += 15;
    } else if (operatingMargin < 0.05) {
      score += 30;
    } else if (operatingMargin < 0.1) {
      score += 40;
    } else {
      score += 50;
    }
    factorCount++;
  }

  if (factorCount === 0) {
    return {
      score: 50,
      reasoning: '財務指標を算出できませんでした',
      riskFlags: ['財務指標算出不可'],
    };
  }

  // Normalize if only one factor available
  if (factorCount === 1) {
    score = Math.round(score * 2);
  }

  return {
    score: Math.min(100, score),
    reasoning: reasoning.join('。'),
    riskFlags,
  };
}

export function calculateFuturePotentialScore(
  gbizInfo: {
    success: boolean;
    subsidyCount?: number;
  },
  edinet: {
    success: boolean;
    filingFound?: boolean;
    financials?: {
      netSales?: number;
    };
  },
): ScoredAxis {
  const riskFlags: string[] = [];
  const reasoning: string[] = [];
  let score = 40; // base score

  if (gbizInfo.success) {
    const subsidyCount = gbizInfo.subsidyCount ?? 0;
    if (subsidyCount > 0) {
      const subsidyBonus = Math.min(30, subsidyCount * 6);
      score += subsidyBonus;
      reasoning.push(`補助金活用活性: ${subsidyCount}件（成長志向を示す）`);
    } else {
      reasoning.push('補助金活用実績なし');
      riskFlags.push('補助金活用なし（成長投資指標なし）');
    }
  }

  if (edinet.success && edinet.filingFound && edinet.financials?.netSales) {
    const netSales = edinet.financials.netSales;
    if (netSales > 1_000_000_000_000) {
      score += 30;
      reasoning.push('大企業規模の売上高');
    } else if (netSales > 100_000_000_000) {
      score += 20;
      reasoning.push('中大企業規模の売上高');
    } else if (netSales > 10_000_000_000) {
      score += 15;
      reasoning.push('中企業規模の売上高');
    } else if (netSales > 1_000_000_000) {
      score += 10;
      reasoning.push('中小企業規模の売上高');
    } else {
      score += 5;
      reasoning.push('小企業規模の売上高');
    }
  } else {
    reasoning.push('EDINET売上データなし（非上場の可能性）');
  }

  return {
    score: Math.min(100, score),
    reasoning: reasoning.join('。'),
    riskFlags,
  };
}

export function aggregateScores(axes: {
  basicTrust: ScoredAxis;
  socialTrust: ScoredAxis;
  financialHealth: ScoredAxis;
  futurePotential: ScoredAxis;
}): AggregateScore {
  const weights = {
    basicTrust: 0.20,
    socialTrust: 0.20,
    financialHealth: 0.35,
    futurePotential: 0.25,
  };

  const overall = Math.round(
    axes.basicTrust.score * weights.basicTrust +
    axes.socialTrust.score * weights.socialTrust +
    axes.financialHealth.score * weights.financialHealth +
    axes.futurePotential.score * weights.futurePotential,
  );

  const allRiskFlags = [
    ...axes.basicTrust.riskFlags,
    ...axes.socialTrust.riskFlags,
    ...axes.financialHealth.riskFlags,
    ...axes.futurePotential.riskFlags,
  ];

  return {
    overall,
    ...axes,
    allRiskFlags,
  };
}
