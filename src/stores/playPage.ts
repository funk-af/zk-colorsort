import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Puzzle, Move } from "../game/types";
import type { PuzzleScoreComparison } from "../algorand/puzzleScores";
import { clonePuzzle, applyMove } from "../game/rules";
import { isPuzzleSolved } from "../game/win";
import { getBestScore, saveBestScore } from "../storage/scores";
import { parseMoveHistory } from "../algorand/puzzleScores";
import {
  generateDailyPuzzleFromIndexer,
  getTodayDateKey,
  shiftDateKey,
} from "../game/daily";
import { puzzleFromText, dailyDateKeyFromText } from "../url/share";

const EARLIEST_DAILY_DATE_KEY = "2026-06-01";

export const usePlayPageStore = defineStore("playPage", () => {
  let latestDailyLoadId = 0;

  // State
  const puzzle = ref<Puzzle | null>(null);
  const startPuzzle = ref<Puzzle | null>(null);
  const bestScore = ref<number | null>(null);
  const dailyDateKey = ref<string | null>(null);
  const loadingDaily = ref(false);
  const todayDateKey = ref(getTodayDateKey());
  const history = ref<Puzzle[]>([]);
  const moveHistory = ref<string[]>([]);
  const selectedTube = ref<number | null>(null);
  const moves = ref(0);
  const status = ref("");
  const toast = ref<string | null>(null);
  const codeInput = ref("");
  const settingsModalOpen = ref(false);
  const scoresModalOpen = ref(false);
  const showColorLetters = ref(false);

  // Score upload state
  const showUploadScore = ref(false);
  // Move list handed over in the URL (e.g. from the Discord Activity's
  // "keep permanently" link); applied once the matching puzzle is loaded.
  let pendingImportedMoves: string[] | null = null;
  const proofReady = ref(false);
  const proofGenerating = ref(false);
  const uploadingScore = ref(false);
  const scoreComparison = ref<PuzzleScoreComparison | null>(null);
  const loadingScoreComparison = ref(false);

  // Computed
  const solved = computed(() => {
    if (!puzzle.value) return false;
    return isPuzzleSolved(puzzle.value);
  });

  const canGoPrevDay = computed(
    () =>
      dailyDateKey.value !== null &&
      dailyDateKey.value > EARLIEST_DAILY_DATE_KEY,
  );

  const canGoNextDay = computed(() => {
    if (dailyDateKey.value === null) return false;
    return dailyDateKey.value < todayDateKey.value;
  });

  const historyLength = computed(() => history.value.length);

  // Actions
  function openPlaySettings() {
    settingsModalOpen.value = true;
  }

  function closePlaySettings() {
    settingsModalOpen.value = false;
  }

  function openScoresModal() {
    scoresModalOpen.value = true;
  }

  function closeScoresModal() {
    scoresModalOpen.value = false;
  }

  function setStatus(message: string, time = 3000) {
    toast.value = message;
    if (time > 0) {
      setTimeout(() => {
        toast.value = null;
      }, time);
    }
  }

  function goToPreviousDaily() {
    const current = dailyDateKey.value ?? todayDateKey.value;
    const previous = shiftDateKey(current, -1);
    if (!previous) {
      setStatus("Unable to load previous day puzzle");
      return;
    }
    if (previous < EARLIEST_DAILY_DATE_KEY) {
      setStatus(`No daily puzzle before ${EARLIEST_DAILY_DATE_KEY}`);
      return;
    }
    void loadDailyPuzzle(previous);
  }

  function goToNextDaily() {
    if (!dailyDateKey.value) {
      return;
    }
    const next = shiftDateKey(dailyDateKey.value, 1);
    const today = todayDateKey.value;
    if (!next || next > today) {
      setStatus("No daily puzzle after today yet");
      return;
    }
    void loadDailyPuzzle(next);
  }

  function loadTodayDaily() {
    const today = getTodayDateKey();
    todayDateKey.value = today;
    void loadDailyPuzzle(today);
  }

  async function loadDailyPuzzle(dateKey: string) {
    const today = getTodayDateKey();
    if (dateKey < EARLIEST_DAILY_DATE_KEY) {
      setStatus(`Daily puzzles start on ${EARLIEST_DAILY_DATE_KEY}`);
      return;
    }
    if (dateKey > today) {
      setStatus("That daily puzzle date is not available yet");
      return;
    }

    const requestId = latestDailyLoadId + 1;
    latestDailyLoadId = requestId;

    dailyDateKey.value = dateKey;
    loadingDaily.value = true;
    todayDateKey.value = today;
    history.value = [];
    moveHistory.value = [];
    selectedTube.value = null;
    moves.value = 0;
    codeInput.value = "";
    scoreComparison.value = null;
    loadingScoreComparison.value = false;
    scoresModalOpen.value = false;

    try {
      const generatedResult = await generateDailyPuzzleFromIndexer(dateKey);
      if (requestId !== latestDailyLoadId) {
        return;
      }

      const generatedPuzzle = generatedResult.puzzle;
      puzzle.value = clonePuzzle(generatedPuzzle);
      startPuzzle.value = clonePuzzle(generatedPuzzle);
      bestScore.value = getBestScore(generatedPuzzle);
      dailyDateKey.value = dateKey;
      loadingDaily.value = false;
      todayDateKey.value = getTodayDateKey();
      history.value = [];
      moveHistory.value = [];
      selectedTube.value = null;
      moves.value = 0;
      applyImportedMoves();
    } catch {
      if (requestId !== latestDailyLoadId) {
        return;
      }
      loadingDaily.value = false;
      setStatus("Unable to load daily puzzle from indexer");
    }
  }

  function resetPlay() {
    if (startPuzzle.value && puzzle.value) {
      puzzle.value = clonePuzzle(startPuzzle.value);
      history.value = [];
      moveHistory.value = [];
      selectedTube.value = null;
      moves.value = 0;
    }
  }

  function togglePlayColorLetters() {
    showColorLetters.value = !showColorLetters.value;
  }

  function updatePlayCodeInput(value: string) {
    codeInput.value = value;
  }

  function loadPlayCodeFromInput() {
    const loaded = puzzleFromText(codeInput.value);
    if (loaded) {
      loadSharedPuzzle(loaded);
      setStatus("Loaded puzzle from pasted code.");
      return;
    }

    const dailyKey = dailyDateKeyFromText(codeInput.value);
    const today = todayDateKey.value;
    if (dailyKey && dailyKey >= EARLIEST_DAILY_DATE_KEY && dailyKey <= today) {
      void loadDailyPuzzle(dailyKey);
      codeInput.value = "";
      setStatus(`Loading daily puzzle for ${dailyKey}...`);
      return;
    }

    setStatus("Invalid puzzle code or date");
  }

  function loadSharedPuzzle(sharedPuzzle: Puzzle) {
    puzzle.value = clonePuzzle(sharedPuzzle);
    startPuzzle.value = clonePuzzle(sharedPuzzle);
    bestScore.value = getBestScore(sharedPuzzle);
    dailyDateKey.value = null;
    loadingDaily.value = false;
    todayDateKey.value = getTodayDateKey();
    history.value = [];
    moveHistory.value = [];
    selectedTube.value = null;
    moves.value = 0;
    codeInput.value = "";
    scoreComparison.value = null;
    loadingScoreComparison.value = false;
    scoresModalOpen.value = false;
    showUploadScore.value = false;
    proofReady.value = false;
    proofGenerating.value = false;
    uploadingScore.value = false;
    applyImportedMoves();
  }

  /**
   * Queue a move list (entries like "3:7", 1-based tube numbers) to be
   * recorded as the best score for the puzzle once it is loaded. Only a list
   * that actually solves the puzzle is accepted.
   */
  function importMoves(imported: string[]) {
    pendingImportedMoves = imported;
    applyImportedMoves();
  }

  function applyImportedMoves() {
    if (!pendingImportedMoves || !startPuzzle.value) {
      return;
    }
    const imported = pendingImportedMoves;
    pendingImportedMoves = null;

    const parsed = parseMoveHistory(imported);
    if (!parsed || parsed.length === 0) {
      setStatus("Ignored shared moves: invalid format", 4000);
      return;
    }

    let board = clonePuzzle(startPuzzle.value);
    for (const move of parsed) {
      const result = applyMove(board, move);
      if (!result) {
        setStatus("Ignored shared moves: not a valid solution", 4000);
        return;
      }
      board = result.puzzle;
    }
    if (!isPuzzleSolved(board)) {
      setStatus("Ignored shared moves: puzzle not solved", 4000);
      return;
    }

    const saved = saveBestScore(startPuzzle.value, parsed.length, imported);
    bestScore.value = getBestScore(startPuzzle.value);
    // The imported solve exists to be submitted, so surface the scores modal.
    scoresModalOpen.value = true;
    if (saved === parsed.length) {
      setStatus(`Imported your ${parsed.length}-move solve`, 4000);
    } else {
      setStatus("Your saved score is already as good or better", 4000);
    }
  }

  function playMove(tubeIndex: number) {
    if (!puzzle.value || loadingDaily.value || solved.value) {
      return;
    }

    if (selectedTube.value === null) {
      if (puzzle.value.tubes[tubeIndex].length > 0) {
        selectedTube.value = tubeIndex;
      }
      return;
    }

    if (selectedTube.value === tubeIndex) {
      selectedTube.value = null;
      return;
    }

    const sourceTube = selectedTube.value;
    const move: Move = { from: sourceTube, to: tubeIndex };
    const result = applyMove(puzzle.value, move);

    if (!result) {
      setStatus("Invalid move");
      selectedTube.value = null;
      return;
    }

    const prevPuzzle = clonePuzzle(puzzle.value);
    puzzle.value = result.puzzle;
    history.value.push(prevPuzzle);
    moveHistory.value.push(`${sourceTube + 1}:${tubeIndex + 1}`);
    moves.value++;
    selectedTube.value = null;

    // Check if solved and save if it's a daily puzzle
    if (solved.value && dailyDateKey.value && startPuzzle.value) {
      saveBestScore(startPuzzle.value, moves.value, moveHistory.value);
      bestScore.value = moves.value;
      scoresModalOpen.value = true;
    }
  }

  function undoMove() {
    if (history.value.length === 0) {
      return;
    }

    const previousPuzzle = history.value.pop();
    if (previousPuzzle) {
      puzzle.value = previousPuzzle;
      moveHistory.value.pop();
      moves.value = Math.max(0, moves.value - 1);
      selectedTube.value = null;
    }
  }

  function handleInvertTubesChange() {
    // This will be handled by settings store
  }

  function setPuzzle(newPuzzle: Puzzle) {
    puzzle.value = newPuzzle;
  }

  function setStartPuzzle(newPuzzle: Puzzle) {
    startPuzzle.value = newPuzzle;
  }

  function setBestScore(score: number | null) {
    bestScore.value = score;
  }

  function setDailyDateKey(key: string | null) {
    dailyDateKey.value = key;
  }

  function setLoadingDaily(loading: boolean) {
    loadingDaily.value = loading;
  }

  function setShowUploadScore(show: boolean) {
    showUploadScore.value = show;
  }

  function setProofReady(ready: boolean) {
    proofReady.value = ready;
  }

  function setProofGenerating(generating: boolean) {
    proofGenerating.value = generating;
  }

  function setUploadingScore(uploading: boolean) {
    uploadingScore.value = uploading;
  }

  function setScoreComparison(comparison: PuzzleScoreComparison | null) {
    scoreComparison.value = comparison;
  }

  function setLoadingScoreComparison(loading: boolean) {
    loadingScoreComparison.value = loading;
  }

  return {
    // State
    puzzle,
    startPuzzle,
    bestScore,
    dailyDateKey,
    loadingDaily,
    todayDateKey,
    history,
    moveHistory,
    selectedTube,
    moves,
    status,
    toast,
    codeInput,
    settingsModalOpen,
    scoresModalOpen,
    showColorLetters,
    showUploadScore,
    proofReady,
    proofGenerating,
    uploadingScore,
    scoreComparison,
    loadingScoreComparison,

    // Computed
    solved,
    canGoPrevDay,
    canGoNextDay,
    historyLength,

    // Actions
    openPlaySettings,
    closePlaySettings,
    openScoresModal,
    closeScoresModal,
    setStatus,
    goToPreviousDaily,
    goToNextDaily,
    loadTodayDaily,
    loadDailyPuzzle,
    loadSharedPuzzle,
    importMoves,
    resetPlay,
    togglePlayColorLetters,
    updatePlayCodeInput,
    loadPlayCodeFromInput,
    playMove,
    undoMove,
    handleInvertTubesChange,
    setPuzzle,
    setStartPuzzle,
    setBestScore,
    setDailyDateKey,
    setLoadingDaily,
    setShowUploadScore,
    setProofReady,
    setProofGenerating,
    setUploadingScore,
    setScoreComparison,
    setLoadingScoreComparison,
  };
});
