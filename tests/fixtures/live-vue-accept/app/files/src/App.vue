<script>
export default { inheritAttrs: false };
</script>
<script setup>
import { ref } from 'vue';
defineProps({ label: String });
const count = ref(0);
const increment = () => count.value++;
</script>
<template>
  <main>
    <h1>Import status</h1>
    <section class="card" @click="increment">
      <p>{{ label }}: {{ count }}</p>
    </section>
    <aside class="unrelated">Outside the selected component</aside>
  </main>
</template>
<style scoped>
.card { width: 400px; min-height: 80px; padding: 8px; color: #111; background: #eee; cursor: pointer; }
.unrelated { padding: 3px; }
</style>
<style>
body { margin: 24px; font: 16px/1.5 system-ui; }
</style>
