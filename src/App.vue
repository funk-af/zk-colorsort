<template>
  <WalletUIProvider theme="system">
    <div class="app">
      <main class="app-content">
        <router-view />
      </main>
      <footer class="app-footer">
        <div class="powered-by" aria-label="Powered by Algorand">
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
        </div>
        <div class="app-version">v{{ appVersion }}</div>
      </footer>
    </div>
  </WalletUIProvider>
</template>

<script setup lang="ts">
import { WalletUIProvider } from "@txnlab/use-wallet-ui-vue";

const appVersion = __APP_VERSION__;
</script>

<style scoped>
.app {
  width: 100%;
}

.app-footer {
  margin-top: 10px;
  width: 100%;
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: #95a2be;
  font-size: 12px;
  letter-spacing: 0.03em;
}

.powered-by {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.app-version {
  font-size: 11px;
  opacity: 0.7;
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
