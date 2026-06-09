<template>
  <div
    :class="`board${solved ? ' solved' : ''}${inverted ? ' inverted' : ' normal'}`"
  >
    <button
      v-for="(tube, tubeIndex) in puzzle.tubes"
      :key="tubeIndex"
      :class="`tube${selectedTube === tubeIndex ? ' selected' : ''}`"
      :aria-label="`Tube ${tubeIndex + 1}`"
      @click="$emit('tube-click', tubeIndex)"
    >
      <span
        v-for="indexFromBottom in puzzle.capacity"
        :key="`${tubeIndex}-${indexFromBottom}`"
        class="cell"
        :class="{ filled: tube[puzzle.capacity - indexFromBottom] }"
        :style="
          {
            '--fill': tube[puzzle.capacity - indexFromBottom] || 'transparent',
          } as Record<string, string>
        "
      >
        <span
          v-if="showColorLetters && tube[puzzle.capacity - indexFromBottom]"
          class="cell-letter"
        >
          {{ colorToLetter(tube[puzzle.capacity - indexFromBottom]) }}
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Puzzle } from "../game/types";

const COLORBLIND_LETTER_MAP: Record<string, string> = {
  "#ff0000": "R",
  "#ffff00": "Y",
  "#ffa500": "O",
  "#00ffff": "C",
  "#00ff00": "G",
  "#0000ff": "B",
  "#800080": "P",
  "#6366f1": "L",
  "#ffffff": "W",
  "#ff00ff": "M",
};

function colorToLetter(color: string): string {
  return COLORBLIND_LETTER_MAP[color.toLowerCase()] ?? "?";
}

defineProps<{
  puzzle: Puzzle;
  selectedTube: number | null;
  solved: boolean;
  inverted: boolean;
  showColorLetters?: boolean;
}>();

defineEmits<{
  "tube-click": [index: number];
}>();
</script>
