import { lute } from "@galaxypay/use-wallet-lute";
import { pera } from "@txnlab/use-wallet-pera";
import { WalletManagerPlugin } from "@txnlab/use-wallet-vue";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import {
  applyDiscordProxyMappings,
  isDiscordActivity,
} from "./discord/activity";
import router from "./router";
import { useDiscordStore } from "./stores/discord";

import "@txnlab/use-wallet-ui-vue/dist/style.css";
import "./style.css";

const app = createApp(App);
const isDev = import.meta.env.DEV;
const inDiscord = isDiscordActivity();

if (inDiscord) {
  // Discord's Activity CSP only allows traffic through its proxy; rewrite
  // node/indexer requests before any client makes one.
  applyDiscordProxyMappings();
}

const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(WalletManagerPlugin, {
  // No wallet connect inside the Discord iframe: sponsored submissions replace
  // it there, and the permanent wallet path opens the website externally.
  wallets: inDiscord ? [] : [lute(), pera()],
  defaultNetwork: isDev && !inDiscord ? "localnet" : "mainnet",
  options: { persistNetwork: isDev && !inDiscord },
});

if (inDiscord) {
  void useDiscordStore(pinia).connect();
}

const rootNode = document.querySelector<HTMLDivElement>("#app");

if (!rootNode) {
  throw new Error("Missing #app root node");
}

app.mount(rootNode);
