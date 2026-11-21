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
  <section class="card" @click="increment">
    <p>{{ label }}: {{ count }}</p>
  </section>
</template>
<style scoped>
.card { padding: 8px; color: #111; }
</style>
