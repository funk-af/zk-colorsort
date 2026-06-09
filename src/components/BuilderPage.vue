<template>
  <main class="layout">
    <Toast :message="toast" />
    <header>
      <div class="header-top">
        <div>
          <h1>Build Puzzle</h1>
          <p>
            {{
              isTesting
                ? "Testing Puzzle"
                : "Create custom puzzles and share them"
            }}
          </p>
        </div>
      </div>
    </header>

    <div v-if="!isTesting" class="controls wrap">
      <button @click="resetBuilderSolved">Reset</button>
      <div class="control-group">
        <button :disabled="!canShiftLeft" @click="shiftBuilderTubeLeft">
          ↶ Left
        </button>
        <button :disabled="!canShiftRight" @click="shiftBuilderTubeRight">
          Right ↷
        </button>
      </div>
      <button :disabled="!canUndo" @click="undoBuilderMove">Undo</button>
    </div>

    <div v-if="isTesting" class="testing-controls testing-controls-top">
      <button class="testing-top-left" @click="backToBuilderEditor">
        Back to Editor
      </button>
      <span class="metric testing-top-right">Moves: {{ testMoves }}</span>
    </div>

    <Board
      v-if="puzzle"
      :puzzle="puzzle"
      :selectedTube="selectedTube"
      :solved="isTesting ? solved : false"
      :inverted="invertTubes"
      :showColorLetters="false"
      @tube-click="handleBoardTubeClick"
    />

    <div v-if="!isTesting" class="controls">
      <button @click="saveBuilderPuzzle">Save Puzzle</button>
      <button @click="startBuilderTest">Test Puzzle</button>
    </div>

    <div v-if="isTesting" class="testing-controls testing-controls-bottom">
      <button class="testing-bottom-left" @click="restartBuilderTest">
        Restart Test
      </button>
      <button
        class="testing-bottom-right"
        :disabled="!canUndo"
        @click="undoBuilderMove"
      >
        Undo
      </button>
    </div>

    <section v-if="!isTesting" class="panel">
      <h2>Saved Puzzles</h2>
      <div v-if="saved.length === 0" class="empty-state">
        <p>No saved puzzles yet.</p>
      </div>
      <div v-else class="saved-puzzles">
        <div v-for="puzzle in saved" :key="puzzle.id" class="puzzle-item">
          <div class="puzzle-meta">
            <div class="puzzle-code">{{ puzzle.id }}</div>
            <div class="puzzle-date">{{ formatDate(puzzle.createdAt) }}</div>
          </div>
          <div class="puzzle-actions">
            <button @click="loadSavedBuilderPuzzle(puzzle)">Load</button>
            <button @click="shareSavedBuilderPuzzle(puzzle)">Share Link</button>
            <button @click="deleteSavedBuilderPuzzle(puzzle)">Delete</button>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useBuilderPageStore } from "../stores/builderPage";
import { puzzleToShareUrl } from "../url/share";
import Board from "./Board.vue";
import Toast from "./Toast.vue";

const builderStore = useBuilderPageStore();

// Initialize puzzle on mount if needed
if (!builderStore.editPuzzle) {
  builderStore.initializePuzzle();
}

// Destructure state for template
const puzzle = computed(() => builderStore.puzzle);
const selectedTube = computed(() => builderStore.selectedTube);
const solved = computed(() => builderStore.solved);
const isTesting = computed(() => builderStore.isTesting);
const canUndo = computed(() => builderStore.canUndo);
const canShiftLeft = computed(() => builderStore.canShiftLeft);
const canShiftRight = computed(() => builderStore.canShiftRight);
const invertTubes = computed(() => builderStore.invertTubes);
const saved = computed(() => builderStore.saved);
const toast = computed(() => builderStore.toast);
const testMoves = computed(() => builderStore.testMoves);

// Handlers
function resetBuilderSolved() {
  builderStore.resetBuilderSolved();
}

function shiftBuilderTubeLeft() {
  builderStore.shiftBuilderTubeLeft();
}

function shiftBuilderTubeRight() {
  builderStore.shiftBuilderTubeRight();
}

function undoBuilderMove() {
  builderStore.undoBuilderMove();
}

function saveBuilderPuzzle() {
  builderStore.saveBuilderPuzzle();
}

function startBuilderTest() {
  builderStore.startBuilderTest();
}

function backToBuilderEditor() {
  builderStore.backToBuilderEditor();
}

function restartBuilderTest() {
  builderStore.restartBuilderTest();
}

function handleBoardTubeClick(tubeIndex: number) {
  builderStore.handleBoardTubeClick(tubeIndex);
}

function loadSavedBuilderPuzzle(entry: (typeof saved.value)[0]) {
  builderStore.loadSavedBuilderPuzzle(entry);
}

function deleteSavedBuilderPuzzle(entry: (typeof saved.value)[0]) {
  builderStore.deleteSavedBuilderPuzzle(entry);
}

async function shareSavedBuilderPuzzle(entry: (typeof saved.value)[0]) {
  try {
    await navigator.clipboard.writeText(puzzleToShareUrl(entry.puzzle, "/"));
    builderStore.setStatus("Share link copied to clipboard");
  } catch {
    builderStore.setStatus("Share link unavailable", 5000);
  }
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString();
}
</script>

<style scoped>
.puzzle-item {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  border: 1px solid var(--soft-ink);
  border-radius: 4px;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.puzzle-meta {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.puzzle-code {
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--ink);
  word-break: break-all;
}

.puzzle-date {
  font-size: 0.875rem;
  color: var(--soft-ink);
}

.puzzle-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-left: auto;
}

.saved-puzzles {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty-state {
  color: var(--soft-ink);
  text-align: center;
  padding: 2rem;
}

.testing-controls {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  align-items: center;
}

.testing-controls-top {
  margin-top: 12px;
}

.testing-controls-bottom {
  margin-top: 12px;
}

.testing-top-left {
  justify-self: start;
}

.testing-top-right {
  justify-self: end;
}

.testing-bottom-left {
  justify-self: start;
}

.testing-bottom-right {
  justify-self: end;
}
</style>
