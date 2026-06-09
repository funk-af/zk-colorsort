import { defineStore } from "pinia";
import { computed } from "vue";
import { useWallet } from "@txnlab/use-wallet-vue";

export const useWalletStore = defineStore("wallet", () => {
  const {
    activeAddress,
    activeWallet,
    wallets,
    isReady,
    signTransactions,
    signData,
  } = useWallet();

  const isWalletConnected = computed(() => Boolean(activeAddress.value));

  return {
    // Wallet composable refs
    activeAddress,
    activeWallet,
    wallets,
    isReady,

    // Computed
    isWalletConnected,

    // Methods from useWallet
    signTransactions,
    signData,
  };
});
