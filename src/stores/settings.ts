import { defineStore } from "pinia";
import { ref } from "vue";

interface Settings {
  invertTubes: boolean;
}

function loadSettings(): Settings {
  const stored = localStorage.getItem("color-sort.settings.v1");
  if (!stored) {
    return { invertTubes: false };
  }

  try {
    return JSON.parse(stored) as Settings;
  } catch {
    return { invertTubes: false };
  }
}

function saveSettings(settings: Settings): void {
  localStorage.setItem("color-sort.settings.v1", JSON.stringify(settings));
}

export const useSettingsStore = defineStore("settings", () => {
  const invertTubes = ref<boolean>(loadSettings().invertTubes);

  function toggleInvertTubes() {
    invertTubes.value = !invertTubes.value;
    saveSettings({ invertTubes: invertTubes.value });
  }

  function setInvertTubes(value: boolean) {
    invertTubes.value = value;
    saveSettings({ invertTubes: value });
  }

  return {
    // State
    invertTubes,

    // Actions
    toggleInvertTubes,
    setInvertTubes,
  };
});
