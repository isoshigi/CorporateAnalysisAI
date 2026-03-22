<script setup lang="ts">
import { ref } from 'vue';
import { marked } from 'marked';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const COMPANY_STORAGE_KEY = 'corporate-analysis-company-name';

const messages = ref<Message[]>([]);
const input = ref('');
const loading = ref(false);
const companyName = ref(localStorage.getItem(COMPANY_STORAGE_KEY) ?? '');
const companyNameInput = ref(companyName.value);
const isEditingCompany = ref(!companyName.value);

function saveCompanyName() {
  const name = companyNameInput.value.trim();
  if (!name) return;
  companyName.value = name;
  localStorage.setItem(COMPANY_STORAGE_KEY, name);
  isEditingCompany.value = false;
}

function editCompanyName() {
  companyNameInput.value = companyName.value;
  isEditingCompany.value = true;
}

function onCompanyKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCompanyName();
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  messages.value.push({ role: 'user', text });
  input.value = '';
  loading.value = true;

  try {
    const userContent = companyName.value
      ? `【調査対象企業：${companyName.value}】\n${text}`
      : text;

    const res = await fetch('/api/agents/company-research-agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: userContent }] }),
    });

    const data = await res.json();
    const reply = data.text ?? JSON.stringify(data);
    messages.value.push({ role: 'assistant', text: reply });
  } catch (e) {
    messages.value.push({ role: 'assistant', text: 'エラーが発生しました。' });
  } finally {
    loading.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}
</script>

<template>
  <div class="chat-container">
    <header class="chat-header">
      <h1>企業求人分析 AI</h1>
    </header>

    <div class="company-bar">
      <label class="company-label">調査対象企業</label>
      <template v-if="isEditingCompany">
        <input
          v-model="companyNameInput"
          class="company-input"
          placeholder="企業名を入力（例：株式会社〇〇）"
          @keydown="onCompanyKeydown"
        />
        <button class="company-save-btn" @click="saveCompanyName" :disabled="!companyNameInput.trim()">保存</button>
      </template>
      <template v-else>
        <span class="company-name">{{ companyName }}</span>
        <button class="company-edit-btn" @click="editCompanyName">変更</button>
      </template>
    </div>

    <div class="message-list">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="['message', msg.role]"
      >
        <span class="bubble" :class="{ markdown: msg.role === 'assistant' }" v-if="msg.role === 'assistant'" v-html="marked(msg.text)" />
        <span class="bubble" v-else>{{ msg.text }}</span>
      </div>
      <div v-if="loading" class="message assistant">
        <span class="bubble loading">...</span>
      </div>
    </div>

    <div class="input-area">
      <textarea
        v-model="input"
        placeholder="メッセージを入力（Enter で送信）"
        rows="2"
        @keydown="onKeydown"
      />
      <button @click="sendMessage" :disabled="loading">送信</button>
    </div>
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 720px;
  margin: 0 auto;
  font-family: sans-serif;
}

.chat-header {
  padding: 16px;
  border-bottom: 1px solid #ddd;
}

.chat-header h1 {
  margin: 0;
  font-size: 1.2rem;
}

.company-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #f7f9ff;
  border-bottom: 1px solid #dde4f5;
}

.company-label {
  font-size: 0.85rem;
  color: #666;
  white-space: nowrap;
}

.company-input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 0.95rem;
  font-family: sans-serif;
}

.company-name {
  flex: 1;
  font-size: 0.95rem;
  font-weight: bold;
  color: #222;
}

.company-save-btn,
.company-edit-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
}

.company-save-btn {
  background: #4f7df3;
  color: white;
}

.company-save-btn:disabled {
  background: #aaa;
  cursor: not-allowed;
}

.company-edit-btn {
  background: #e8ecf8;
  color: #4f7df3;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 16px;
  white-space: pre-wrap;
  line-height: 1.5;
}

.bubble.markdown {
  white-space: normal;
}

.bubble.markdown :deep(h2),
.bubble.markdown :deep(h3) {
  margin: 0.6em 0 0.3em;
  font-size: 1rem;
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
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .bubble {
  background: #f0f0f0;
  color: #222;
  border-bottom-left-radius: 4px;
}

.loading {
  color: #999;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #ddd;
}

.input-area textarea {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 8px;
  resize: none;
  font-size: 0.95rem;
  font-family: sans-serif;
}

.input-area button {
  padding: 10px 20px;
  background: #4f7df3;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95rem;
}

.input-area button:disabled {
  background: #aaa;
  cursor: not-allowed;
}
</style>
