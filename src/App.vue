<template>
  <WalletUIProvider theme="system">
    <div class="app">
      <main class="app-content">
        <router-view />
      </main>
      <footer class="powered-by" aria-label="Powered by Algorand">
        <span>Powered by</span>
        <a
          href="https://algorand.co/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Visit Algorand"
        >
          <img
            src="/algorand-logo-light.svg"
            alt="Algorand"
            class="algorand-wordmark"
          />
        </a>
      </footer>
    </div>
  </WalletUIProvider>
</template>

<script setup lang="ts">
import { WalletUIProvider } from "@txnlab/use-wallet-ui-vue";
</script>

<style scoped>
.app {
  width: 100%;
}

.powered-by {
  margin-top: 10px;
  width: 100%;
  padding: 6px 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: #95a2be;
  font-size: 12px;
  letter-spacing: 0.03em;
}

.algorand-wordmark {
  height: 14px;
  width: auto;
  display: block;
}

.powered-by a {
  display: inline-flex;
  align-items: center;
  opacity: 0.9;
}

.powered-by a:hover {
  opacity: 1;
}
</style>
