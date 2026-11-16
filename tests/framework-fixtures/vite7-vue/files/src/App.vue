<script setup>
import { ref } from 'vue';
const label = ref('Leave a note');
const note = ref('');
</script>

<template>
  <main class="page">
    <form class="note-form" @submit.prevent>
      <label class="note-label">{{ label }}</label>
      <textarea v-model="note" class="note-input" :class="{ filled: note.length > 0 }" />
    </form>
  </main>
</template>
