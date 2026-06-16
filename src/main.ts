import { createApp } from "vue";
import { createPinia } from "pinia";
import { NetworkId, WalletId } from "@txnlab/use-wallet-vue";
import { WalletManagerPlugin } from "@txnlab/use-wallet-vue";
import "@txnlab/use-wallet-ui-vue/dist/style.css";
import "./style.css";
import App from "./App.vue";
import router from "./router";

const app = createApp(App);
const isDev = import.meta.env.DEV;

app.use(createPinia());
app.use(router);
app.use(WalletManagerPlugin, {
  wallets: [WalletId.LUTE, WalletId.PERA],
  defaultNetwork: isDev ? NetworkId.LOCALNET : NetworkId.MAINNET,
  options: { resetNetwork: !isDev },
});

const rootNode = document.querySelector<HTMLDivElement>("#app");

if (!rootNode) {
  throw new Error("Missing #app root node");
}

app.mount(rootNode);
