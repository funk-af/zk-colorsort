import { lute } from "@galaxypay/use-wallet-lute";
import { pera } from "@txnlab/use-wallet-pera";
import { WalletManagerPlugin } from "@txnlab/use-wallet-vue";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";

import "@txnlab/use-wallet-ui-vue/dist/style.css";
import "./style.css";

const app = createApp(App);
const isDev = import.meta.env.DEV;

app.use(createPinia());
app.use(router);
app.use(WalletManagerPlugin, {
  wallets: [lute(), pera()],
  defaultNetwork: isDev ? "localnet" : "mainnet",
  options: { persistNetwork: isDev },
});

const rootNode = document.querySelector<HTMLDivElement>("#app");

if (!rootNode) {
  throw new Error("Missing #app root node");
}

app.mount(rootNode);
