<script setup lang="ts">
import { ref, computed } from 'vue';
import { marked } from 'marked';

type Step = 'input' | 'analyzing' | 'result' | 'chat';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const step = ref<Step>('input');
const companyName = ref('');
const techStack = ref('');
const analysisText = ref('');
const matchScore = ref<number | null>(null);
const analysisError = ref('');
const analysisUserContent = ref('');

const chatMessages = ref<ChatMessage[]>([]);
const chatInput = ref('');
const chatLoading = ref(false);

function extractMatchScore(text: string): number | null {
  const match = text.match(/MATCH_SCORE[：:]\s*(\d+)/);
  return match ? Math.min(100, Math.max(0, parseInt(match[1]))) : null;
}

function cleanAnalysisText(text: string): string {
  return text.replace(/MATCH_SCORE[：:]\s*\d+\n?/g, '').trim();
}

async function analyze() {
  const company = companyName.value.trim();
  const tech = techStack.value.trim();
  if (!company || !tech) return;

  step.value = 'analyzing';
  analysisError.value = '';

  const userContent = `【分析】\n企業名：${company}\n技術スタック：${tech}`;
  analysisUserContent.value = userContent;

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
    analysisText.value = cleanAnalysisText(reply);
    step.value = 'result';
  } catch {
    analysisError.value = 'エラーが発生しました。もう一度お試しください。';
    step.value = 'result';
  }
}

function startChat() {
  chatMessages.value = [];
  step.value = 'chat';
}

function resetToInput() {
  step.value = 'input';
  chatMessages.value = [];
  analysisText.value = '';
  matchScore.value = null;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || chatLoading.value) return;

  chatMessages.value.push({ role: 'user', text });
  chatInput.value = '';
  chatLoading.value = true;

  try {
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
    chatMessages.value.push({ role: 'assistant', text: reply });
  } catch {
    chatMessages.value.push({ role: 'assistant', text: 'エラーが発生しました。' });
  } finally {
    chatLoading.value = false;
  }
}

function onChatKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

const scoreColor = computed(() => {
  const s = matchScore.value ?? 0;
  if (s >= 70) return '#22c55e';
  if (s >= 40) return '#f59e0b';
  return '#ef4444';
});

const scoreLabel = computed(() => {
  const s = matchScore.value ?? 0;
  if (s >= 70) return '高マッチ';
  if (s >= 40) return '中マッチ';
  return '低マッチ';
});

// SVG circle: r=40, circumference = 2π×40 ≈ 251.33
const scoreCircumference = 251.33;
const scoreDasharray = computed(() => {
  const s = matchScore.value ?? 0;
  const filled = (s / 100) * scoreCircumference;
  return `${filled} ${scoreCircumference}`;
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

    <!-- Step 1: Input -->
    <div v-if="step === 'input'" class="step-input">
      <div class="input-card">
        <div class="input-card-title">分析する企業と技術スタックを入力</div>

        <div class="field">
          <label class="field-label">企業名</label>
          <input
            v-model="companyName"
            class="field-input"
            placeholder="例：株式会社〇〇"
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

    <!-- Step 1: Analyzing -->
    <div v-if="step === 'analyzing'" class="step-analyzing">
      <div class="analyzing-spinner" />
      <p class="analyzing-text">企業情報と技術スタックを分析中...</p>
    </div>

    <!-- Step 1: Result -->
    <div v-if="step === 'result'" class="step-result">
      <div v-if="analysisError" class="error-box">{{ analysisError }}</div>

      <template v-else>
        <div class="score-section">
          <svg class="score-ring" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" stroke-width="10" />
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              :stroke="scoreColor"
              stroke-width="10"
              stroke-linecap="round"
              :stroke-dasharray="scoreDasharray"
              transform="rotate(-90 50 50)"
            />
            <text x="50" y="46" text-anchor="middle" font-size="22" font-weight="bold" :fill="scoreColor">
              {{ matchScore ?? '?' }}
            </text>
            <text x="50" y="62" text-anchor="middle" font-size="10" fill="#6b7280">/ 100</text>
          </svg>
          <div class="score-meta">
            <div class="score-company">{{ companyName }}</div>
            <div class="score-label-badge" :style="{ color: scoreColor }">{{ scoreLabel }}</div>
            <p class="score-description">あなたの技術スタックとのマッチ度</p>
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

    <!-- Step 2: Chat -->
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

/* Step 1: Input */
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

/* Step 1: Result */
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

/* Step 2: Chat */
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
