<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main class="page">
    <p>Vue frontend is ready.</p>
    <button type="button" @click="count += 1">Count: {{ count }}</button>
  </main>
</template>