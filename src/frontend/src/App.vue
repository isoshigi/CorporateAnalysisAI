<script setup lang="ts">
import { ref } from 'vue';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const messages = ref<Message[]>([]);
const input = ref('');
const loading = ref(false);

async function sendMessage() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  messages.value.push({ role: 'user', text });
  input.value = '';
  loading.value = true;

  try {
    const res = await fetch('/api/agents/weather-agent/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: text }] }),
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
      <h1>AI Chat</h1>
    </header>

    <div class="message-list">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="['message', msg.role]"
      >
        <span class="bubble">{{ msg.text }}</span>
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
