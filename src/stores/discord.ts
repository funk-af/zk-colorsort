import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import {
  connectDiscordActivity,
  isDiscordActivity,
  type DiscordIdentity,
} from "../discord/activity";

export type DiscordActivityStatus = "idle" | "connecting" | "ready" | "error";

/**
 * Identity of the player inside a Discord Activity. Outside Discord this
 * store stays idle and the app behaves exactly like the website.
 */
export const useDiscordStore = defineStore("discord", () => {
  const isActivity = ref(isDiscordActivity());
  const status = ref<DiscordActivityStatus>("idle");
  const identity = shallowRef<DiscordIdentity | null>(null);
  const error = ref<string | null>(null);

  const isReady = computed(
    () => isActivity.value && status.value === "ready" && identity.value !== null,
  );

  async function connect(): Promise<void> {
    if (!isActivity.value || status.value === "connecting" || isReady.value) {
      return;
    }
    status.value = "connecting";
    error.value = null;
    try {
      identity.value = await connectDiscordActivity();
      status.value = "ready";
    } catch (cause) {
      console.warn("Discord Activity connection failed", cause);
      error.value = cause instanceof Error ? cause.message : String(cause);
      status.value = "error";
    }
  }

  return { isActivity, status, identity, error, isReady, connect };
});
