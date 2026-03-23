<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { marked } from 'marked';
import ScoreRing from './ScoreRing.vue';

// 画面の状態を管理する型
type Step = 'input' | 'analyzing' | 'check' | 'result' | 'chat';

// 各項目のスコア
interface ItemScore {
  label: string;
  score: number;
  max: number;
}

// チャットのメッセージの型
interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// 現在の画面ステップ
const step = ref<Step>('input');

// localStorageから保存済みの入力値を読み込む
function loadFromStorage<T>(key: string, fallback: T): T {
  const saved = localStorage.getItem(key);
  if (saved === null) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
}

// 企業情報の入力モード
type InputMode = 'manual' | 'extract';
const inputMode = ref<InputMode>('manual');
const extractText = ref('');
const extracting = ref(false);

// 分析フォームの入力値（localStorageから復元）
const companyName = ref('');
const jobCategory = ref('');  // 採用カテゴリー（企業側・毎回入力）
const techStack = ref(loadFromStorage('techStack', ''));
const jobTypes = ref(loadFromStorage('jobTypes', ['', '', '']));
const preferredLocation = ref(loadFromStorage('preferredLocation', ''));  // 希望勤務地（保存）
const salaryType = ref<'年収' | '月収'>(loadFromStorage('salaryType', '年収'));
const salaryAmount = ref(loadFromStorage('salaryAmount', ''));
const graduationType = ref(loadFromStorage('graduationType', ''));

// 入力値が変わるたびにlocalStorageに保存する
watch(techStack, v => localStorage.setItem('techStack', JSON.stringify(v)));
watch(jobTypes, v => localStorage.setItem('jobTypes', JSON.stringify(v)), { deep: true });
watch(preferredLocation, v => localStorage.setItem('preferredLocation', JSON.stringify(v)));
watch(salaryType, v => localStorage.setItem('salaryType', JSON.stringify(v)));
watch(salaryAmount, v => localStorage.setItem('salaryAmount', JSON.stringify(v)));
watch(graduationType, v => localStorage.setItem('graduationType', JSON.stringify(v)));

// 分析結果
const analysisText = ref('');
const matchScore = ref<number | null>(null);
const analysisError = ref('');
const analysisUserContent = ref('');
const itemScores = ref<ItemScore[]>([]);
const summaryComment = ref('');

// チャット関連
const chatMessages = ref<ChatMessage[]>([]);
const chatInput = ref('');
const chatLoading = ref(false);

// AIの回答テキストからマッチスコアを抽出する
function extractMatchScore(text: string): number | null {
  // MATCH_SCORE:XX 形式（[]あり・なし・全角コロン対応）
  let m = text.match(/MATCH_SCORE[：:]\s*\[?(\d+)\]?/);
  if (m) return Math.min(100, Math.max(0, parseInt(m[1])));
  // フォールバック: ## マッチ度分析（スコア：XX/100）形式
  m = text.match(/スコア[：:＊* ]*(\d+)\s*[/／]/);
  if (m) return Math.min(100, Math.max(0, parseInt(m[1])));
  return null;
}

// 表示不要な指示テキストをAIの回答から除去する
function cleanAnalysisText(text: string): string {
  return text.replace(/【重要】.*\n/g, '').replace(/MATCH_SCORE[：:]\s*\[?\d+\]?\n?/g, '').trim();
}

// AIの回答から各項目のスコアを抽出する
function extractItemScores(text: string): ItemScore[] {
  const items = [
    { label: '給料・待遇', max: 40 },
    { label: '企業規模・安定性', max: 10 },
    { label: '業務内容', max: 25 },
    { label: '技術スタック', max: 25 },
  ];
  return items.map(item => {
    const re = new RegExp(`${item.label}（(\\d+)\\/${item.max}点）`);
    const m = text.match(re);
    return { label: item.label, score: m ? parseInt(m[1]) : 0, max: item.max };
  });
}

// AIの回答から総合コメントの1行目を抽出する
function extractSummaryComment(text: string): string {
  const m = text.match(/総合コメント\s*\n+([\s\S]+?)(?:\n---|\n##|$)/);
  if (!m) return '';
  return m[1].trim().split('\n')[0].replace(/^\*+|\*+$/g, '').trim();
}

// 項目スコアの割合に応じた色を返す
function itemBarColor(item: ItemScore): string {
  const pct = item.score / item.max;
  if (pct >= 0.7) return '#22c55e';
  if (pct >= 0.4) return '#f59e0b';
  return '#ef4444';
}

// 企業と技術スタックの分析
async function analyze() {
  
  // 空白や改行の除去
  const company = companyName.value.trim();
  const tech = techStack.value.trim();

  // 入力に不備がある場合は処理を中断
  if (!company || !tech) return;
  
  // 分析開始
  step.value = 'analyzing';
  analysisError.value = '';
  
  // ユーザーの入力をもとに分析用のプロンプトを生成
  const jobCategoryLine = jobCategory.value.trim() ? `\n採用カテゴリー：${jobCategory.value.trim()}` : '';
  const filledJobs = jobTypes.value.map(j => j.trim()).filter(Boolean);
  const jobLine = filledJobs.length > 0 ? `\n希望職種：${filledJobs.join('、')}` : '';
  const locationLine = preferredLocation.value.trim() ? `\n希望勤務地：${preferredLocation.value.trim()}` : '';
  const salaryStr = String(salaryAmount.value).trim();
  const salaryLine = salaryStr
    ? `\n希望給与：${salaryType.value} ${salaryStr}万円`
    : '';
  const graduationLine = graduationType.value ? `\n卒業区分：${graduationType.value}` : '';
  const userContent = `【分析】\n企業名：${company}${jobCategoryLine}${jobLine}${locationLine}${salaryLine}${graduationLine}\n技術スタック：${tech}`;
  analysisUserContent.value = userContent;
  
  // APIに分析をリクエスト
  try {
    const res = await fetch('/api/agents/company-research-agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await res.json();
    const reply = data.text ?? JSON.stringify(data);
    matchScore.value = extractMatchScore(reply);
    const cleaned = cleanAnalysisText(reply);
    analysisText.value = cleaned;
    itemScores.value = extractItemScores(reply);
    summaryComment.value = extractSummaryComment(cleaned);
    // 50点以下の場合は確認画面を挟む
    if (matchScore.value !== null && matchScore.value <= 50) {
      step.value = 'check';
    } else {
      step.value = 'result';
    }
  } catch {
    analysisError.value = 'エラーが発生しました。もう一度お試しください。';
    step.value = 'input';
  }
}

// チャット画面に遷移する
function startChat() {
  chatMessages.value = [];
  step.value = 'chat';
}

// 入力画面に戻り、分析結果をリセットする（入力値はlocalStorageから復元）
function resetToInput() {
  step.value = 'input';
  chatMessages.value = [];
  analysisText.value = '';
  matchScore.value = null;
  itemScores.value = [];
  summaryComment.value = '';
  companyName.value = '';
  jobCategory.value = '';
  techStack.value = loadFromStorage('techStack', '');
  jobTypes.value = loadFromStorage('jobTypes', ['', '', '']);
  preferredLocation.value = loadFromStorage('preferredLocation', '');
  salaryType.value = loadFromStorage('salaryType', '年収');
  salaryAmount.value = loadFromStorage('salaryAmount', '');
  graduationType.value = loadFromStorage('graduationType', '');
}

// テキストから企業名と採用カテゴリーを抽出してフォームに反映する
async function extractFromText() {
  const text = extractText.value.trim();
  if (!text || extracting.value) return;

  extracting.value = true;
  try {
    const res = await fetch('/api/agents/company-research-agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: `【抽出】\n${text}` }],
      }),
    });
    const data = await res.json();
    const reply = (data.text ?? '').trim();
    // ```json...``` ブロックや裸のJSONにも対応
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.companyName) companyName.value = parsed.companyName;
      if (parsed.jobCategory) jobCategory.value = parsed.jobCategory;
    }
  } catch {
    // 抽出失敗時はフィールドを空のまま維持
  } finally {
    extracting.value = false;
  }
}

// チャットメッセージを送信し、AIの返答を取得する
async function sendChat() {
  const text = chatInput.value.trim();

  // 空メッセージや送信中は処理しない
  if (!text || chatLoading.value) return;

  // ユーザーのメッセージを即座に表示する
  chatMessages.value.push({ role: 'user', text });
  chatInput.value = '';
  chatLoading.value = true;

  try {
    // 分析結果を会話の文脈として含め、APIにリクエストする
    const messages = [
      { role: 'user', content: analysisUserContent.value },
      { role: 'assistant', content: analysisText.value },
      ...chatMessages.value.slice(0, -1).map(m => ({ role: m.role, content: m.text })),
      { role: 'user', content: text },
    ];

    const res = await fetch('/api/agents/company-research-agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    const data = await res.json();
    const reply = data.text ?? JSON.stringify(data);

    // AIの返答を表示する
    chatMessages.value.push({ role: 'assistant', text: reply });
  } catch {
    chatMessages.value.push({ role: 'assistant', text: 'エラーが発生しました。' });
  } finally {
    chatLoading.value = false;
  }
}

// Enterキーで送信（Shift+Enterは改行）
function onChatKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

// スコアに応じてリングの色を変える
const scoreColor = computed(() => {
  const s = matchScore.value ?? 0;
  if (s >= 70) return '#22c55e';
  if (s >= 40) return '#f59e0b';
  return '#ef4444';
});

// スコアに応じてラベルを変える
const scoreLabel = computed(() => {
  const s = matchScore.value ?? 0;
  if (s >= 70) return '高マッチ';
  if (s >= 40) return '中マッチ';
  return '低マッチ';
});

</script>

<template>
  <div class="app">
    <header class="header">
      <h1>企業×技術スタック マッチ度分析</h1>
      <div v-if="step === 'chat'" class="header-meta">
        <span class="header-company">{{ companyName }}</span>
        <span class="score-badge" :style="{ background: scoreColor }">
          {{ matchScore ?? '?' }}/100
        </span>
      </div>
    </header>

    <!-- Step 0: 入力画面 -->
    <div v-if="step === 'input'" class="step-input">
      <div class="input-card">
        <div class="input-card-title">分析する企業と条件を入力</div>

        <div class="field">
          <label class="field-label">希望する職種 <span class="field-optional">（最大3つ）</span></label>
          <div class="job-type-row">
            <input
              v-for="(_, i) in jobTypes"
              :key="i"
              v-model="jobTypes[i]"
              class="field-input job-input"
              :placeholder="`職種 ${i + 1}`"
            />
          </div>
        </div>

        <div class="field">
          <label class="field-label">希望給与 <span class="field-optional">（任意）</span></label>
          <div class="salary-row">
            <div class="salary-toggle">
              <button
                :class="['toggle-btn', { active: salaryType === '年収' }]"
                @click="salaryType = '年収'"
                type="button"
              >年収</button>
              <button
                :class="['toggle-btn', { active: salaryType === '月収' }]"
                @click="salaryType = '月収'"
                type="button"
              >月収</button>
            </div>
            <input
              v-model="salaryAmount"
              class="field-input salary-input"
              type="number"
              min="0"
              placeholder="例：500"
            />
            <span class="salary-unit">万円</span>
          </div>
        </div>

        <div class="field">
          <label class="field-label">希望勤務地 <span class="field-optional">（任意）</span></label>
          <input
            v-model="preferredLocation"
            class="field-input"
            placeholder="例：東京都内、リモート可"
          />
        </div>

        <div class="field">
          <label class="field-label">卒業区分 <span class="field-optional">（任意）</span></label>
          <div class="graduation-row">
            <button
              v-for="opt in ['高卒', '学部卒', '修士卒', '博士卒']"
              :key="opt"
              :class="['toggle-btn', 'graduation-btn', { active: graduationType === opt }]"
              @click="graduationType = graduationType === opt ? '' : opt"
              type="button"
            >{{ opt }}</button>
          </div>
        </div>

        <div class="input-mode-toggle">
          <button
            :class="['toggle-btn', { active: inputMode === 'manual' }]"
            @click="inputMode = 'manual'"
            type="button"
          >企業情報を入力</button>
          <button
            :class="['toggle-btn', { active: inputMode === 'extract' }]"
            @click="inputMode = 'extract'"
            type="button"
          >テキストから自動判定</button>
        </div>

        <div v-if="inputMode === 'extract'" class="field">
          <label class="field-label">メール・テキストを貼り付け</label>
          <textarea
            v-model="extractText"
            class="field-textarea"
            placeholder="採用担当からのメール本文などを貼り付けてください"
            rows="5"
          />
          <button
            class="extract-btn"
            :disabled="!extractText.trim() || extracting"
            @click="extractFromText"
            type="button"
          >
            {{ extracting ? '抽出中...' : '企業情報を抽出する' }}
          </button>
        </div>

        <div class="field">
          <label class="field-label">会社名</label>
          <input
            v-model="companyName"
            class="field-input"
            placeholder="例：株式会社〇〇"
          />
        </div>

        <div class="field">
          <label class="field-label">採用カテゴリー <span class="field-optional">（任意）</span></label>
          <input
            v-model="jobCategory"
            class="field-input"
            placeholder="例：フロントエンドエンジニア（新卒）"
          />
        </div>

        <div class="field">
          <label class="field-label">あなたの技術スタック</label>
          <textarea
            v-model="techStack"
            class="field-textarea"
            placeholder="例：React, TypeScript, Node.js, Docker, PostgreSQL"
            rows="4"
          />
          <p class="field-hint">カンマや改行で区切って入力してください</p>
        </div>

        <button
          class="analyze-btn"
          :disabled="!companyName.trim() || !techStack.trim()"
          @click="analyze"
        >
          分析する
        </button>
      </div>
    </div>

    <!-- Step 1: 分析中 -->
    <div v-if="step === 'analyzing'" class="step-analyzing">
      <div class="analyzing-spinner" />
      <p class="analyzing-text">企業情報と技術スタックを分析中...</p>
    </div>

    <!-- Step 2: 低スコア確認画面 -->
    <div v-if="step === 'check'" class="step-check">
      <div class="check-card">
        <div class="check-header">
          <ScoreRing :score="matchScore" :color="scoreColor" />
          <div class="check-meta">
            <div class="score-company">{{ companyName }}</div>
            <div class="score-label-badge" :style="{ color: scoreColor }">{{ scoreLabel }}</div>
            <p v-if="summaryComment" class="check-summary">{{ summaryComment }}</p>
          </div>
        </div>

        <div class="check-items">
          <div v-for="item in itemScores" :key="item.label" class="check-item">
            <span class="check-item-label">{{ item.label }}</span>
            <div class="check-item-bar-wrap">
              <div
                class="check-item-bar"
                :style="{ width: `${(item.score / item.max) * 100}%`, background: itemBarColor(item) }"
              />
            </div>
            <span class="check-item-score">{{ item.score }}/{{ item.max }}</span>
          </div>
        </div>

        <div class="check-actions">
          <button class="chat-btn" @click="step = 'result'">詳細レポートを見る</button>
          <button class="reset-btn" @click="resetToInput">検索に戻る</button>
        </div>
      </div>
    </div>

    <!-- Step 3: 詳細レポート -->
    <div v-if="step === 'result'" class="step-result">
      <div v-if="analysisError" class="error-box">{{ analysisError }}</div>

      <template v-else>
        <div class="score-section">
          <ScoreRing :score="matchScore" :color="scoreColor" />
          <div class="score-meta">
            <div class="score-company">{{ companyName }}</div>
            <div class="score-label-badge" :style="{ color: scoreColor }">{{ scoreLabel }}</div>
            <p class="score-description">あなたの技術スタックとのマッチ度</p>
          </div>
        </div>

        <div v-if="itemScores.length > 0" class="score-items">
          <div v-for="item in itemScores" :key="item.label" class="check-item">
            <span class="check-item-label">{{ item.label }}</span>
            <div class="check-item-bar-wrap">
              <div
                class="check-item-bar"
                :style="{ width: `${(item.score / item.max) * 100}%`, background: itemBarColor(item) }"
              />
            </div>
            <span class="check-item-score">{{ item.score }}/{{ item.max }}</span>
          </div>
        </div>

        <div class="analysis-body" v-html="marked(analysisText)" />
      </template>

      <div class="result-actions">
        <button class="chat-btn" @click="startChat" :disabled="!!analysisError">
          この結果について質問する
        </button>
        <button class="reset-btn" @click="resetToInput">もう一度分析する</button>
      </div>
    </div>

    <!-- Step 4: AIChat -->
    <div v-if="step === 'chat'" class="step-chat">
      <div class="message-list">
        <div v-if="chatMessages.length === 0" class="chat-hint">
          分析結果についてなんでも質問してください。
        </div>
        <div
          v-for="(msg, i) in chatMessages"
          :key="i"
          :class="['message', msg.role]"
        >
          <span
            class="bubble"
            :class="{ markdown: msg.role === 'assistant' }"
            v-if="msg.role === 'assistant'"
            v-html="marked(msg.text)"
          />
          <span class="bubble" v-else>{{ msg.text }}</span>
        </div>
        <div v-if="chatLoading" class="message assistant">
          <span class="bubble loading">...</span>
        </div>
      </div>

      <div class="chat-input-area">
        <button class="back-btn" @click="() => (step = 'result')">← 結果に戻る</button>
        <textarea
          v-model="chatInput"
          placeholder="質問を入力（Enter で送信）"
          rows="2"
          @keydown="onChatKeydown"
        />
        <button class="send-btn" @click="sendChat" :disabled="chatLoading">送信</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 760px;
  margin: 0 auto;
  font-family: sans-serif;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
}

.header h1 {
  margin: 0;
  font-size: 1.1rem;
  color: #111;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-company {
  font-size: 0.9rem;
  color: #555;
  font-weight: bold;
}

.score-badge {
  font-size: 0.8rem;
  color: #fff;
  font-weight: bold;
  padding: 3px 10px;
  border-radius: 999px;
}

/* Step 0: Input */
.input-mode-toggle {
  display: flex;
  gap: 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 4px;
}

.input-mode-toggle .toggle-btn {
  flex: 1;
  border-radius: 0;
  border: none;
  border-right: 1px solid #e5e7eb;
}

.input-mode-toggle .toggle-btn:last-child {
  border-right: none;
}

.extract-btn {
  margin-top: 8px;
  width: 100%;
  padding: 10px;
  background: #4f7df3;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
}

.extract-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

.extract-btn:hover:not(:disabled) {
  background: #3b6de0;
}

.step-input {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
}

.input-card {
  width: 100%;
  max-width: 540px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}

.input-card-title {
  font-size: 1rem;
  font-weight: bold;
  color: #222;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #444;
}

.field-input,
.field-textarea {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.95rem;
  font-family: sans-serif;
  outline: none;
  transition: border-color 0.15s;
}

.field-input:focus,
.field-textarea:focus {
  border-color: #4f7df3;
}

.field-textarea {
  resize: vertical;
}

.field-hint {
  margin: 0;
  font-size: 0.78rem;
  color: #9ca3af;
}

.field-optional {
  font-weight: 400;
  color: #9ca3af;
  font-size: 0.8rem;
}

.job-type-row {
  display: flex;
  gap: 8px;
}

.job-input {
  flex: 1;
  min-width: 0;
}

.salary-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.salary-toggle {
  display: flex;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.toggle-btn {
  padding: 9px 14px;
  background: #fff;
  border: none;
  font-size: 0.88rem;
  cursor: pointer;
  color: #6b7280;
  transition: background 0.12s, color 0.12s;
}

.toggle-btn.active {
  background: #4f7df3;
  color: #fff;
  font-weight: bold;
}

.salary-input {
  width: 120px;
  flex-shrink: 0;
}

.salary-unit {
  font-size: 0.9rem;
  color: #555;
  white-space: nowrap;
}

.graduation-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.graduation-btn {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.88rem;
}

.graduation-btn.active {
  background: #4f7df3;
  color: #fff;
  border-color: #4f7df3;
  font-weight: bold;
}

.graduation-btn:not(.active) {
  background: #fff;
  color: #374151;
}

.analyze-btn {
  padding: 12px;
  background: #4f7df3;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.15s;
}

.analyze-btn:hover:not(:disabled) {
  background: #3b6de0;
}

.analyze-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

/* Step 1: Analyzing */
.step-analyzing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.analyzing-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid #e5e7eb;
  border-top-color: #4f7df3;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.analyzing-text {
  color: #6b7280;
  font-size: 0.95rem;
}

/* Step 2: Check */
.step-check {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
}

.check-card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.check-header {
  display: flex;
  align-items: center;
  gap: 20px;
}

.check-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.check-summary {
  margin: 0;
  font-size: 0.85rem;
  color: #374151;
  line-height: 1.5;
}

.check-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.check-item-label {
  width: 130px;
  flex-shrink: 0;
  font-size: 0.85rem;
  color: #374151;
}

.check-item-bar-wrap {
  flex: 1;
  height: 8px;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
}

.check-item-bar {
  height: 100%;
  border-radius: 999px;
  transition: width 0.4s ease;
}

.check-item-score {
  width: 40px;
  text-align: right;
  font-size: 0.8rem;
  color: #6b7280;
  flex-shrink: 0;
}

.check-actions {
  display: flex;
  gap: 12px;
}

/* Step 3: Result */
.score-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 16px 20px;
}

.step-result {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 28px 20px;
  gap: 24px;
  overflow-y: auto;
}

.error-box {
  padding: 16px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #dc2626;
}

.score-section {
  display: flex;
  align-items: center;
  gap: 24px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 24px;
}

.score-ring {
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

.score-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.score-company {
  font-size: 1.2rem;
  font-weight: bold;
  color: #111;
}

.score-label-badge {
  font-size: 1rem;
  font-weight: bold;
}

.score-description {
  margin: 0;
  font-size: 0.85rem;
  color: #6b7280;
}

.analysis-body {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 24px;
  line-height: 1.7;
  font-size: 0.95rem;
  color: #222;
}

.analysis-body :deep(h2) {
  font-size: 1rem;
  margin: 1em 0 0.4em;
  color: #111;
}

.analysis-body :deep(h3) {
  font-size: 0.95rem;
  margin: 0.8em 0 0.3em;
  color: #333;
}

.analysis-body :deep(p) {
  margin: 0.4em 0;
}

.analysis-body :deep(ul),
.analysis-body :deep(ol) {
  margin: 0.3em 0;
  padding-left: 1.4em;
}

.analysis-body :deep(strong) {
  font-weight: bold;
}

.result-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.chat-btn {
  flex: 1;
  min-width: 160px;
  padding: 12px;
  background: #4f7df3;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: bold;
  cursor: pointer;
}

.chat-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

.chat-btn:hover:not(:disabled) {
  background: #3b6de0;
}

.reset-btn {
  padding: 12px 20px;
  background: #f3f4f6;
  color: #374151;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
}

.reset-btn:hover {
  background: #e5e7eb;
}

/* Step 3: AIChat */
.step-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-hint {
  text-align: center;
  color: #9ca3af;
  font-size: 0.9rem;
  padding: 32px 0;
}

.message {
  display: flex;
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 16px;
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 0.93rem;
}

.bubble.markdown {
  white-space: normal;
}

.bubble.markdown :deep(h2),
.bubble.markdown :deep(h3) {
  margin: 0.5em 0 0.25em;
  font-size: 0.95rem;
}

.bubble.markdown :deep(p) {
  margin: 0.3em 0;
}

.bubble.markdown :deep(ul),
.bubble.markdown :deep(ol) {
  margin: 0.3em 0;
  padding-left: 1.4em;
}

.bubble.markdown :deep(strong) {
  font-weight: bold;
}

.message.user .bubble {
  background: #4f7df3;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message.assistant .bubble {
  background: #f3f4f6;
  color: #222;
  border-bottom-left-radius: 4px;
}

.loading {
  color: #9ca3af;
}

.chat-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.back-btn {
  padding: 8px 12px;
  background: #f3f4f6;
  color: #374151;
  border: none;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  white-space: nowrap;
}

.back-btn:hover {
  background: #e5e7eb;
}

.chat-input-area textarea {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  resize: none;
  font-size: 0.93rem;
  font-family: sans-serif;
  outline: none;
}

.chat-input-area textarea:focus {
  border-color: #4f7df3;
}

.send-btn {
  padding: 10px 18px;
  background: #4f7df3;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.93rem;
  white-space: nowrap;
}

.send-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

.send-btn:hover:not(:disabled) {
  background: #3b6de0;
}
</style>
