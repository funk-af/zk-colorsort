<template>
  <main class="layout legal">
    <header class="legal-header">
      <router-link to="/" class="legal-back">← Back to the game</router-link>
      <h1>{{ title }}</h1>
      <p class="hint">Effective {{ effectiveDate }}</p>
    </header>
    <section class="panel legal-body">
      <slot />
    </section>
    <nav class="legal-links" aria-label="Legal pages">
      <router-link to="/terms">Terms of Service</router-link>
      <span aria-hidden="true">·</span>
      <router-link to="/privacy">Privacy Policy</router-link>
    </nav>
  </main>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  effectiveDate: string;
}>();
</script>

<style scoped>
.legal {
  max-width: 760px;
}

.legal-header h1 {
  margin: 8px 0 4px;
}

.legal-back {
  font-size: 14px;
}

.legal-body {
  text-align: left;
  line-height: 1.55;
}

.legal-body :deep(h2) {
  font-size: 18px;
  margin: 22px 0 8px;
}

.legal-body :deep(h2:first-child) {
  margin-top: 0;
}

.legal-body :deep(p),
.legal-body :deep(li) {
  color: var(--ink);
  font-size: 15px;
}

.legal-body :deep(ul) {
  padding-left: 20px;
}

.legal-links {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  gap: 10px;
  color: var(--soft-ink);
  font-size: 13px;
}
</style>
