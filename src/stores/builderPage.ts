import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Puzzle } from "../game/types";
import type { StoredPuzzle } from "../storage/puzzles";
import { clonePuzzle, applyMove } from "../game/rules";
import { deletePuzzle, loadSavedPuzzles, savePuzzle } from "../storage/puzzles";
import { validatePuzzle } from "../game/validator";
import { buildSolvedPuzzle } from "../game/generator";
import { DEFAULT_COLORS, DEFAULT_CONFIG } from "../game/types";
import { isPuzzleSolved } from "../game/win";
import { useSettingsStore } from "./settings";

export const useBuilderPageStore = defineStore("builderPage", () => {
  const settingsStore = useSettingsStore();

  // State
  const editPuzzle = ref<Puzzle | null>(null);
  const editHistory = ref<Puzzle[]>([]);
  const selectedEditTube = ref<number | null>(null);
  const testPuzzle = ref<Puzzle | null>(null);
  const testHistory = ref<Puzzle[]>([]);
  const selectedTestTube = ref<number | null>(null);
  const testMoves = ref(0);
  const status = ref("");
  const toast = ref<string | null>(null);
  const saved = ref<StoredPuzzle[]>([]);

  // Computed
  const puzzle = computed(() => testPuzzle.value ?? editPuzzle.value);
  const selectedTube = computed(
    () => selectedTestTube.value ?? selectedEditTube.value,
  );
  const isTesting = computed(() => testPuzzle.value !== null);
  const invertTubes = computed(() => settingsStore.invertTubes);

  const canUndo = computed(() => {
    if (isTesting.value) {
      return testHistory.value.length > 0;
    }
    return editHistory.value.length > 0;
  });

  const canShiftLeft = computed(() => {
    if (isTesting.value || !editPuzzle.value) return false;
    return selectedEditTube.value !== null && selectedEditTube.value > 0;
  });

  const canShiftRight = computed(() => {
    if (isTesting.value || !editPuzzle.value) return false;
    return (
      selectedEditTube.value !== null &&
      selectedEditTube.value < editPuzzle.value.tubes.length - 1
    );
  });

  const solved = computed(() => {
    if (!puzzle.value) return false;
    return isPuzzleSolved(puzzle.value);
  });

  // Actions
  function createDefaultPuzzle(): Puzzle {
    return buildSolvedPuzzle(
      DEFAULT_CONFIG.capacity,
      DEFAULT_COLORS.slice(0, DEFAULT_CONFIG.colors),
      DEFAULT_CONFIG.emptyTubes,
    );
  }

  function setStatus(message: string, time = 3000) {
    toast.value = message;
    if (time > 0) {
      setTimeout(() => {
        toast.value = null;
      }, time);
    }
  }

  function initializePuzzle() {
    editPuzzle.value = createDefaultPuzzle();
    editHistory.value = [];
    selectedEditTube.value = null;
    testPuzzle.value = null;
    testHistory.value = [];
    selectedTestTube.value = null;
    testMoves.value = 0;
    saved.value = loadSavedPuzzles();
  }

  function resetBuilderSolved() {
    editPuzzle.value = createDefaultPuzzle();
    editHistory.value = [];
    selectedEditTube.value = null;
    setStatus("Builder reset to solved baseline");
  }

  function undoBuilderMove() {
    if (testPuzzle.value) {
      const nextHistory = [...testHistory.value];
      const restored = nextHistory.pop();
      if (!restored) {
        setStatus("No move to undo");
        return;
      }
      testPuzzle.value = restored;
      selectedTestTube.value = null;
      testHistory.value = nextHistory;
      testMoves.value = Math.max(0, testMoves.value - 1);
    } else if (editPuzzle.value) {
      const nextHistory = [...editHistory.value];
      const restored = nextHistory.pop();
      if (!restored) {
        setStatus("No move to undo");
        return;
      }
      editPuzzle.value = restored;
      selectedEditTube.value = null;
      editHistory.value = nextHistory;
    }
  }

  function shiftBuilderTubeLeft() {
    if (!editPuzzle.value || selectedEditTube.value === null) {
      return;
    }

    const selected = selectedEditTube.value;
    const target = selected - 1;
    if (target < 0) {
      return;
    }

    const previousPuzzle = clonePuzzle(editPuzzle.value);
    const nextPuzzle = clonePuzzle(editPuzzle.value);
    const [tube] = nextPuzzle.tubes.splice(selected, 1);
    nextPuzzle.tubes.splice(target, 0, tube);

    editPuzzle.value = nextPuzzle;
    selectedEditTube.value = target;
    editHistory.value.push(previousPuzzle);
  }

  function shiftBuilderTubeRight() {
    if (!editPuzzle.value || selectedEditTube.value === null) {
      return;
    }

    const selected = selectedEditTube.value;
    const target = selected + 1;
    if (!editPuzzle.value || target >= editPuzzle.value.tubes.length) {
      return;
    }

    const previousPuzzle = clonePuzzle(editPuzzle.value);
    const nextPuzzle = clonePuzzle(editPuzzle.value);
    const [tube] = nextPuzzle.tubes.splice(selected, 1);
    nextPuzzle.tubes.splice(target, 0, tube);

    editPuzzle.value = nextPuzzle;
    selectedEditTube.value = target;
    editHistory.value.push(previousPuzzle);
  }

  function backToBuilderEditor() {
    testPuzzle.value = null;
    testHistory.value = [];
    selectedTestTube.value = null;
    testMoves.value = 0;
  }

  function restartBuilderTest() {
    if (!editPuzzle.value) return;
    testPuzzle.value = clonePuzzle(editPuzzle.value);
    testHistory.value = [];
    selectedTestTube.value = null;
    testMoves.value = 0;
    setStatus("Play test restarted");
  }

  function startBuilderTest() {
    if (!editPuzzle.value) return;

    const validation = validatePuzzle(editPuzzle.value);
    if (!validation.valid) {
      setStatus(`Cannot start test. ${validation.reasons.join(" ")}`);
      return;
    }

    testPuzzle.value = clonePuzzle(editPuzzle.value);
    testHistory.value = [];
    selectedTestTube.value = null;
    testMoves.value = 0;
    setStatus("Play test started");
  }

  function handleEditTubeClick(tubeIndex: number) {
    if (!editPuzzle.value) return;

    if (selectedEditTube.value === null) {
      selectedEditTube.value = tubeIndex;
      return;
    }

    if (selectedEditTube.value === tubeIndex) {
      selectedEditTube.value = null;
      return;
    }

    const sourceTube = selectedEditTube.value;
    const fromTube = editPuzzle.value.tubes[sourceTube];
    const toTube = editPuzzle.value.tubes[tubeIndex];
    if (!fromTube || !toTube || fromTube.length === 0 || toTube.length >= editPuzzle.value.capacity) {
      selectedEditTube.value = tubeIndex;
      return;
    }

    const prevPuzzle = clonePuzzle(editPuzzle.value);
    const nextPuzzle = clonePuzzle(editPuzzle.value);
    const movedCell = nextPuzzle.tubes[sourceTube].pop();
    if (!movedCell) {
      selectedEditTube.value = tubeIndex;
      return;
    }
    nextPuzzle.tubes[tubeIndex].push(movedCell);

    editPuzzle.value = nextPuzzle;
    editHistory.value.push(prevPuzzle);
    selectedEditTube.value = null;
  }

  function handleTestTubeClick(tubeIndex: number) {
    if (!testPuzzle.value) return;

    if (selectedTestTube.value === null) {
      if (testPuzzle.value.tubes[tubeIndex].length > 0) {
        selectedTestTube.value = tubeIndex;
      }
      return;
    }

    if (selectedTestTube.value === tubeIndex) {
      selectedTestTube.value = null;
      return;
    }

    const sourceTube = selectedTestTube.value;
    const result = applyMove(testPuzzle.value, {
      from: sourceTube,
      to: tubeIndex,
    });

    if (!result) {
      setStatus("Invalid move");
      selectedTestTube.value = null;
      return;
    }

    const prevPuzzle = clonePuzzle(testPuzzle.value);
    testPuzzle.value = result.puzzle;
    testHistory.value.push(prevPuzzle);
    testMoves.value++;
    selectedTestTube.value = null;
  }

  function handleBoardTubeClick(tubeIndex: number) {
    if (testPuzzle.value) {
      handleTestTubeClick(tubeIndex);
    } else {
      handleEditTubeClick(tubeIndex);
    }
  }

  function saveBuilderPuzzle() {
    if (!editPuzzle.value) return;

    try {
      savePuzzle(editPuzzle.value);
      saved.value = loadSavedPuzzles();
      setStatus("Saved puzzle");
    } catch {
      setStatus(
        "Save failed. Puzzle must be a 12-tube setup with 2 empty trailing tubes.",
        5000,
      );
    }
  }

  function loadSavedBuilderPuzzle(entry: StoredPuzzle) {
    editPuzzle.value = clonePuzzle(entry.puzzle);
    editHistory.value = [];
    selectedEditTube.value = null;
    testPuzzle.value = null;
    testHistory.value = [];
    selectedTestTube.value = null;
    testMoves.value = 0;
  }

  function deleteSavedBuilderPuzzle(entry: StoredPuzzle) {
    if (!confirm("Are you sure you want to delete the puzzle?")) {
      return;
    }
    deletePuzzle(entry.id);
    saved.value = loadSavedPuzzles();
    setStatus("Saved puzzle deleted");
  }

  // Setters for external state updates
  function setEditPuzzle(newPuzzle: Puzzle) {
    editPuzzle.value = newPuzzle;
  }

  function setSelectedEditTube(index: number | null) {
    selectedEditTube.value = index;
  }

  function setSaved(puzzles: StoredPuzzle[]) {
    saved.value = puzzles;
  }

  return {
    // State
    editPuzzle,
    editHistory,
    selectedEditTube,
    testPuzzle,
    testHistory,
    selectedTestTube,
    testMoves,
    status,
    toast,
    saved,

    // Computed
    puzzle,
    selectedTube,
    isTesting,
    invertTubes,
    canUndo,
    canShiftLeft,
    canShiftRight,
    solved,

    // Actions
    initializePuzzle,
    createDefaultPuzzle,
    setStatus,
    resetBuilderSolved,
    undoBuilderMove,
    shiftBuilderTubeLeft,
    shiftBuilderTubeRight,
    backToBuilderEditor,
    restartBuilderTest,
    startBuilderTest,
    handleEditTubeClick,
    handleTestTubeClick,
    handleBoardTubeClick,
    saveBuilderPuzzle,
    loadSavedBuilderPuzzle,
    deleteSavedBuilderPuzzle,
    setEditPuzzle,
    setSelectedEditTube,
    setSaved,
  };
});
