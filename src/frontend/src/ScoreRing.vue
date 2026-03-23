<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  score: number | null;
  color: string;
}>();

const circumference = 251.33; // 2π × 40

const dasharray = computed(() => {
  const s = Math.min(100, Math.max(0, props.score ?? 0));
  const filled = (s / 100) * circumference;
  return `${filled} ${circumference}`;
});
</script>

<template>
  <svg class="score-ring" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" stroke-width="10" />
    <circle
      cx="50" cy="50" r="40"
      fill="none"
      :stroke="color"
      stroke-width="10"
      stroke-linecap="round"
      :stroke-dasharray="dasharray"
      transform="rotate(-90 50 50)"
    />
    <text x="50" y="46" text-anchor="middle" font-size="22" font-weight="bold" :fill="color">
      {{ score ?? '?' }}
    </text>
    <text x="50" y="62" text-anchor="middle" font-size="10" fill="#6b7280">/ 100</text>
  </svg>
</template>
