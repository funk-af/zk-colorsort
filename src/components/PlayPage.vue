<template>
  <main class="layout">
    <Toast :message="toast" />
    <header>
      <div class="header-top">
        <div>
          <h1>ZK Color Sort</h1>
          <p>{{ dailyDateKey ?? "Custom puzzle" }}</p>
        </div>
        <div class="header-actions">
          <div v-if="isDev" ref="networkMenuRoot" class="network-menu">
            <button
              class="network-button"
              :disabled="networkSwitchDisabled"
              :aria-expanded="networkMenuOpen"
              aria-haspopup="menu"
              aria-label="Switch network"
              @click="toggleNetworkMenu"
            >
              {{ activeNetworkLabel }}
            </button>
            <div
              v-if="networkMenuOpen"
              class="network-menu-panel"
              role="menu"
              aria-label="Network options"
            >
              <button
                v-for="network in networkOptions"
                :key="network.networkId"
                class="network-menu-item"
                :class="{
                  'is-active': activeNetworkId === network.networkId,
                }"
                :disabled="networkSwitchDisabled"
                role="menuitemradio"
                :aria-checked="activeNetworkId === network.networkId"
                @click="selectNetwork(network.networkId)"
              >
                {{ network.name }}
              </button>
            </div>
          </div>
          <button
            class="settings-button"
            @click="openPlaySettings"
            aria-label="Open settings"
          >
            ⚙️
          </button>
        </div>
      </div>
    </header>

    <div
      v-if="loadingDaily"
      class="loading-panel"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="loading-spinner" aria-hidden="true" />
      <p>Fetching puzzle...</p>
    </div>
    <template v-else>
      <div class="controls wrap">
        <div v-if="dailyDateKey" class="control-group">
          <button
            :disabled="loadingDaily || !canGoPrevDay"
            @click="goToPreviousDaily"
          >
            ❮
          </button>
          <button
            :disabled="loadingDaily || !canGoNextDay"
            @click="goToNextDaily"
          >
            ❯
          </button>
        </div>
        <button v-else :disabled="loadingDaily" @click="loadTodayDaily">
          Daily Today
        </button>
        <span v-if="bestScore !== null" class="metric"
          >Best: {{ bestScore }}</span
        >
        <span class="metric">
          {{ solved ? "Score" : "Moves" }}: {{ moves }}
        </span>
      </div>

      <Board
        v-if="puzzle"
        :puzzle="puzzle"
        :selectedTube="selectedTube"
        :solved="solved"
        :inverted="invertTubes"
        :showColorLetters="showColorLetters"
        @tube-click="playMove"
      />

      <div class="controls">
        <button
          :disabled="loadingDaily || historyLength === 0"
          @click="resetPlay"
        >
          Reset
        </button>
        <div class="control-group">
          <button
            class="icon-toggle"
            :aria-label="`${showColorLetters ? 'Hide' : 'Show'} color letters`"
            :aria-pressed="showColorLetters"
            :disabled="loadingDaily"
            @click="togglePlayColorLetters"
          >
            👁
          </button>
          <button
            :disabled="loadingDaily || historyLength === 0"
            @click="undoMove"
          >
            Undo
          </button>
        </div>
      </div>

      <section class="panel score-panel">
        <div class="score-panel-head">
          <div>
            <h2>Scores</h2>
            <p class="hint">
              {{
                !isWalletConnected
                  ? "Connect your Algorand wallet to unlock this feature"
                  : loadingScoreComparison
                    ? "Loading how your recorded score compares..."
                    : scoreComparison
                      ? formatScoreComparisonSummary(scoreComparison)
                      : "Submit your score to see how it compares to others"
              }}
            </p>
          </div>
          <div class="header-actions">
            <WalletButton size="sm" />
          </div>
        </div>
        <div>
          <button
            v-if="showUploadScore"
            :disabled="loadingDaily || uploadingScore || !proofReady"
            @click="handleUploadScore"
          >
            {{
              proofGenerating
                ? "Generating proof..."
                : uploadingScore
                  ? "Uploading..."
                  : scoreComparison
                    ? "Update Score"
                    : "Submit Score"
            }}
          </button>
        </div>
        <ScoreHistogram v-if="scoreComparison" :comparison="scoreComparison" />
        <div v-if="scoreComparison" class="score-actions">
          <button
            class="small-button"
            :disabled="loadingDaily || removingScore"
            @click="handleRemoveScore"
          >
            {{ removingScore ? "Removing..." : "remove score" }}
          </button>
        </div>
      </section>
    </template>

    <SettingsModal
      :open="settingsModalOpen"
      :invertTubes="invertTubes"
      @close="closePlaySettings"
      @invert-change="handleInvertTubesChange"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NetworkId, useNetwork, useWallet } from "@txnlab/use-wallet-vue";
import { useRoute, useRouter } from "vue-router";
import { usePlayPageStore } from "../stores/playPage";
import { useWalletStore } from "../stores/wallet";
import { useSettingsStore } from "../stores/settings";
import {
  generateScoreProof,
  getPuzzleScoreComparisonOnChain,
  getScoreUploadStatusOnChain,
  removeScoreOnChain,
  saveScoreOnChain,
  type GeneratedScoreProof,
  type PuzzleScoreComparison,
} from "../algorand/puzzleScores";
import { encodePuzzle } from "../game/serialize";
import { getTodayDateKey, parseDateKey } from "../game/daily";
import { getBestScoreMoves } from "../storage/scores";
import { puzzleFromText } from "../url/share";
import Board from "./Board.vue";
import ScoreHistogram from "./ScoreHistogram.vue";
import SettingsModal from "./SettingsModal.vue";
import Toast from "./Toast.vue";
import { WalletButton } from "@txnlab/use-wallet-ui-vue";
import networks from "../networks.json";

interface NetworkOption {
  name: string;
  networkId: NetworkId;
}

const playStore = usePlayPageStore();
const walletStore = useWalletStore();
const settingsStore = useSettingsStore();
const route = useRoute();
const router = useRouter();
const { activeAddress, algodClient, transactionSigner } = useWallet();
const { activeNetwork, setActiveNetwork } = useNetwork();
const isDev = import.meta.env.DEV;
const networkMenuOpen = ref(false);
const networkMenuRoot = ref<HTMLElement | null>(null);
const switchingNetwork = ref(false);

const networkOptions = (networks as { name: string; networkId: string }[])
  .map((item) => ({
    name: item.name,
    networkId: item.networkId.toLowerCase() as NetworkId,
  }))
  .filter(
    (item): item is NetworkOption =>
      item.networkId === NetworkId.MAINNET ||
      item.networkId === NetworkId.TESTNET ||
      item.networkId === NetworkId.LOCALNET,
  );

let scoreLookupRequestId = 0;
let proofGenerationRequestId = 0;
const precomputedProof = ref<GeneratedScoreProof | null>(null);
const precomputedProofKey = ref<string | null>(null);
const removingScore = ref(false);

// Destructure state for template
const dailyDateKey = computed(() => playStore.dailyDateKey);
const toast = computed(() => playStore.toast);
const loadingDaily = computed(() => playStore.loadingDaily);
const canGoPrevDay = computed(() => playStore.canGoPrevDay);
const canGoNextDay = computed(() => playStore.canGoNextDay);
const bestScore = computed(() => playStore.bestScore);
const solved = computed(() => playStore.solved);
const moves = computed(() => playStore.moves);
const puzzle = computed(() => playStore.puzzle);
const selectedTube = computed(() => playStore.selectedTube);
const showColorLetters = computed(() => playStore.showColorLetters);
const historyLength = computed(() => playStore.historyLength);
const settingsModalOpen = computed(() => playStore.settingsModalOpen);
const showUploadScore = computed(() => playStore.showUploadScore);
const proofReady = computed(() => playStore.proofReady);
const proofGenerating = computed(() => playStore.proofGenerating);
const uploadingScore = computed(() => playStore.uploadingScore);
const scoreComparison = computed(() => playStore.scoreComparison);
const loadingScoreComparison = computed(() => playStore.loadingScoreComparison);
const isWalletConnected = computed(() => walletStore.isWalletConnected);
const invertTubes = computed(() => settingsStore.invertTubes);
const activeNetworkId = computed(() =>
  (activeNetwork.value ?? "").toLowerCase(),
);
const activeNetworkLabel = computed(() => {
  const matched = networkOptions.find(
    (item) => item.networkId === activeNetworkId.value,
  );
  return matched?.name ?? "Network";
});
const networkSwitchDisabled = computed(
  () =>
    loadingDaily.value ||
    uploadingScore.value ||
    proofGenerating.value ||
    removingScore.value ||
    switchingNetwork.value,
);

// Handlers
function formatScoreComparisonSummary(
  comparison: PuzzleScoreComparison,
): string {
  if (comparison.otherPlayersCount === 0) {
    return `Your ${comparison.userScore}-move score is recorded. You are first!`;
  }

  const tieText =
    comparison.tiedPlayersCount > 0
      ? ` Tied with ${comparison.tiedPlayersCount} other ${comparison.tiedPlayersCount === 1 ? "player" : "players"}.`
      : "";

  return `Your score (${comparison.userScore}) is better than ${comparison.betterThanPercent}% of other players.${tieText}`;
}

function openPlaySettings() {
  playStore.openPlaySettings();
}

function closePlaySettings() {
  playStore.closePlaySettings();
}

function toggleNetworkMenu() {
  if (networkSwitchDisabled.value) {
    return;
  }
  networkMenuOpen.value = !networkMenuOpen.value;
}

function closeNetworkMenu() {
  networkMenuOpen.value = false;
}

async function selectNetwork(networkId: NetworkId) {
  if (networkSwitchDisabled.value || networkId === activeNetworkId.value) {
    closeNetworkMenu();
    return;
  }

  switchingNetwork.value = true;
  try {
    await setActiveNetwork(networkId);
    playStore.setStatus(`Switched to ${networkId}`);
  } catch (error) {
    console.warn("Unable to switch network", error);
    playStore.setStatus("Unable to switch network", 3500);
  } finally {
    switchingNetwork.value = false;
    closeNetworkMenu();
  }
}

function handleNetworkMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeNetworkMenu();
  }
}

function handleDocumentClick(event: MouseEvent) {
  if (!networkMenuOpen.value) {
    return;
  }

  const root = networkMenuRoot.value;
  const target = event.target;
  if (!root || !(target instanceof Node) || root.contains(target)) {
    return;
  }

  closeNetworkMenu();
}

function goToPreviousDaily() {
  playStore.goToPreviousDaily();
}

function goToNextDaily() {
  playStore.goToNextDaily();
}

function loadTodayDaily() {
  playStore.loadTodayDaily();
}

function resetPlay() {
  playStore.resetPlay();
}

function togglePlayColorLetters() {
  playStore.togglePlayColorLetters();
}

function playMove(tubeIndex: number) {
  playStore.playMove(tubeIndex);
}

function undoMove() {
  playStore.undoMove();
}

function handleInvertTubesChange(inverted: boolean) {
  settingsStore.setInvertTubes(inverted);
}

async function handleUploadScore() {
  const sender = activeAddress.value;
  const currentPuzzle = playStore.startPuzzle;
  const networkId = activeNetwork.value || "testnet";
  const candidateScore = playStore.bestScore ?? 0;

  if (!sender) {
    playStore.setStatus("Connect your wallet before uploading a score");
    return;
  }

  if (!currentPuzzle || candidateScore <= 0) {
    playStore.setStatus("Solve a puzzle first to submit a score");
    return;
  }

  const moveHistory = getBestScoreMoves(currentPuzzle) ?? [];
  if (moveHistory.length !== candidateScore) {
    playStore.setStatus(
      "Unable to upload score: missing move history for proof generation",
      5000,
    );
    return;
  }

  const proofKey = getProofKey(candidateScore);
  const proofToUse =
    proofKey && precomputedProofKey.value === proofKey
      ? precomputedProof.value
      : null;

  if (!proofToUse) {
    playStore.setStatus("Proof is not ready yet. Please wait.");
    return;
  }

  playStore.setUploadingScore(true);
  try {
    const result = await saveScoreOnChain({
      networkId,
      algodClient: algodClient.value,
      sender,
      signer: transactionSigner,
      puzzle: currentPuzzle,
      moveHistory,
      score: candidateScore,
      precomputedProof: proofToUse,
      requirePrecomputedProof: true,
    });

    if (result === "added" || result === "updated") {
      playStore.setStatus("Score uploaded", 3000);
    } else {
      playStore.setStatus("Score already recorded", 3000);
    }
  } catch (error) {
    console.warn("Unable to upload score", error);
    playStore.setStatus("Unable to upload score", 3500);
  } finally {
    playStore.setUploadingScore(false);
    await refreshOnChainScoreState();
    await refreshPrecomputedProof();
  }
}

async function handleRemoveScore() {
  const sender = activeAddress.value;
  const currentPuzzle = playStore.startPuzzle;
  const networkId = activeNetwork.value || "testnet";

  if (!sender) {
    playStore.setStatus("Connect your wallet before removing your score");
    return;
  }

  if (!currentPuzzle) {
    playStore.setStatus("Puzzle data is missing");
    return;
  }

  const confirmed = window.confirm(
    "Remove your recorded score for this puzzle?",
  );
  if (!confirmed) {
    return;
  }

  removingScore.value = true;
  try {
    const removed = await removeScoreOnChain({
      networkId,
      algodClient: algodClient.value,
      sender,
      signer: transactionSigner,
      puzzle: currentPuzzle,
    });

    if (removed) {
      playStore.setStatus("Score removed", 3000);
    } else {
      playStore.setStatus("Unable to remove score", 3000);
    }
  } catch (error) {
    console.warn("Unable to remove score", error);
    playStore.setStatus("Unable to remove score", 3500);
  } finally {
    removingScore.value = false;
    await refreshOnChainScoreState();
    await refreshPrecomputedProof();
  }
}

function getProofKey(score: number | null): string | null {
  const sender = activeAddress.value;
  if (!playStore.startPuzzle || !sender || !score || score <= 0) {
    return null;
  }

  try {
    return `${encodePuzzle(playStore.startPuzzle)}:${sender}:${score}`;
  } catch {
    return null;
  }
}

function clearPrecomputedProofState() {
  precomputedProof.value = null;
  precomputedProofKey.value = null;
  playStore.setProofReady(false);
  playStore.setProofGenerating(false);
}

async function refreshPrecomputedProof() {
  const requestId = proofGenerationRequestId + 1;
  proofGenerationRequestId = requestId;

  const sender = activeAddress.value;
  const currentPuzzle = playStore.startPuzzle;
  const candidateScore = playStore.bestScore ?? 0;
  const networkId = activeNetwork.value || "testnet";

  if (
    !sender ||
    !currentPuzzle ||
    playStore.loadingDaily ||
    !playStore.showUploadScore ||
    candidateScore <= 0
  ) {
    clearPrecomputedProofState();
    return;
  }

  const proofKey = getProofKey(candidateScore);
  if (!proofKey) {
    clearPrecomputedProofState();
    return;
  }

  if (precomputedProofKey.value === proofKey && precomputedProof.value) {
    playStore.setProofReady(true);
    playStore.setProofGenerating(false);
    return;
  }

  const bestMoves = getBestScoreMoves(currentPuzzle) ?? [];
  if (bestMoves.length !== candidateScore) {
    clearPrecomputedProofState();
    return;
  }

  playStore.setProofReady(false);
  playStore.setProofGenerating(true);

  try {
    const generatedProof = await generateScoreProof({
      networkId,
      algodClient: algodClient.value,
      sender,
      puzzle: currentPuzzle,
      moveHistory: bestMoves,
      score: candidateScore,
    });

    if (requestId !== proofGenerationRequestId) {
      return;
    }

    precomputedProof.value = generatedProof;
    precomputedProofKey.value = proofKey;
    playStore.setProofReady(true);
  } catch {
    if (requestId !== proofGenerationRequestId) {
      return;
    }
    clearPrecomputedProofState();
  } finally {
    if (requestId === proofGenerationRequestId) {
      playStore.setProofGenerating(false);
    }
  }
}

async function refreshOnChainScoreState() {
  const requestId = scoreLookupRequestId + 1;
  scoreLookupRequestId = requestId;

  const sender = activeAddress.value;
  const currentPuzzle = playStore.startPuzzle;
  const networkId = activeNetwork.value || "testnet";

  if (!sender || !currentPuzzle || playStore.loadingDaily) {
    playStore.setShowUploadScore(false);
    playStore.setScoreComparison(null);
    playStore.setLoadingScoreComparison(false);
    return;
  }

  const candidateScore = playStore.bestScore ?? 0;
  if (candidateScore <= 0) {
    playStore.setShowUploadScore(false);
  }

  try {
    const uploadStatus = await getScoreUploadStatusOnChain({
      networkId,
      algodClient: algodClient.value,
      sender,
      puzzle: currentPuzzle,
      score: candidateScore,
    });

    if (requestId !== scoreLookupRequestId) {
      return;
    }

    playStore.setShowUploadScore(
      candidateScore > 0 && uploadStatus === "needs-upload",
    );
  } catch {
    if (requestId !== scoreLookupRequestId) {
      return;
    }
    playStore.setShowUploadScore(candidateScore > 0);
  }

  playStore.setLoadingScoreComparison(true);
  try {
    const status = await getScoreUploadStatusOnChain({
      networkId,
      algodClient: algodClient.value,
      sender,
      puzzle: currentPuzzle,
      score: 0,
    });

    if (requestId !== scoreLookupRequestId) {
      return;
    }

    if (status !== "recorded") {
      playStore.setScoreComparison(null);
      return;
    }

    const comparison = await getPuzzleScoreComparisonOnChain({
      networkId,
      algodClient: algodClient.value,
      sender,
      puzzle: currentPuzzle,
    });

    if (requestId !== scoreLookupRequestId) {
      return;
    }

    playStore.setScoreComparison(comparison);
  } catch {
    if (requestId !== scoreLookupRequestId) {
      return;
    }
    playStore.setScoreComparison(null);
  } finally {
    if (requestId === scoreLookupRequestId) {
      playStore.setLoadingScoreComparison(false);
    }
  }
}

function loadFromRouteState() {
  const routeCode =
    typeof route.params.puzzleCode === "string"
      ? route.params.puzzleCode.trim()
      : "";

  if (routeCode && routeCode !== "build") {
    const sharedPuzzle = puzzleFromText(routeCode);
    if (sharedPuzzle) {
      playStore.loadSharedPuzzle(sharedPuzzle);
      return;
    }
  }

  const rawHash = route.hash.replace(/^#/, "").trim();
  const sharedFromHash = rawHash ? puzzleFromText(rawHash) : null;
  if (sharedFromHash) {
    playStore.loadSharedPuzzle(sharedFromHash);
    return;
  }

  if (rawHash && parseDateKey(rawHash)) {
    if (
      playStore.dailyDateKey === rawHash &&
      playStore.puzzle &&
      !playStore.loadingDaily
    ) {
      return;
    }
    void playStore.loadDailyPuzzle(rawHash);
    return;
  }

  if (!playStore.puzzle && !playStore.loadingDaily) {
    playStore.loadTodayDaily();
  }
}

onMounted(() => {
  loadFromRouteState();
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleNetworkMenuKeydown);
});

onUnmounted(() => {
  document.removeEventListener("click", handleDocumentClick);
  document.removeEventListener("keydown", handleNetworkMenuKeydown);
});

watch([() => route.params.puzzleCode, () => route.hash], () => {
  loadFromRouteState();
});

watch(
  () => playStore.dailyDateKey,
  (dateKey) => {
    if (!dateKey) {
      return;
    }

    const today = getTodayDateKey();
    const nextHash = dateKey && dateKey !== today ? `#${dateKey}` : "";
    if (route.hash === nextHash) {
      return;
    }

    void router.replace({ hash: nextHash || undefined });
  },
);

watch(
  [
    () => activeAddress.value,
    () => activeNetwork.value,
    () => playStore.loadingDaily,
    () => playStore.startPuzzle,
    () => playStore.bestScore,
  ],
  () => {
    void refreshOnChainScoreState();
  },
  { immediate: true },
);

watch(
  [
    () => activeAddress.value,
    () => activeNetwork.value,
    () => playStore.loadingDaily,
    () => playStore.startPuzzle,
    () => playStore.bestScore,
    () => playStore.showUploadScore,
  ],
  () => {
    void refreshPrecomputedProof();
  },
  { immediate: true },
);
</script>
