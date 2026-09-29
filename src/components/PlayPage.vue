<template>
  <main class="layout">
    <Toast :message="toast" />
    <header>
      <div class="header-top">
        <div>
          <h1>Color Sort</h1>
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
        <div v-if="dailyDateKey && !isActivity" class="control-group">
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
        <button
          v-else-if="!isActivity"
          :disabled="loadingDaily"
          @click="loadTodayDaily"
        >
          Daily Today
        </button>
        <span class="metric">
          {{ solved ? "Score" : "Moves" }}: {{ moves }}
        </span>
        <button
          :disabled="loadingDaily"
          aria-haspopup="dialog"
          @click="openScoresModal"
        >
          Scores
        </button>
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
        <span v-if="personalBest !== null" class="metric" title="Personal Best"
          >PB: {{ personalBest }}</span
        >
        <span v-if="globalBest !== null" class="metric" title="Global Best"
          >GB: {{ globalBest }}</span
        >

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

      <div
        v-if="isActivity && discordStatus === 'error'"
        class="panel discord-banner"
        role="alert"
      >
        <p class="hint">Discord sign-in failed.</p>
        <p class="hint discord-error">{{ discordError }}</p>
        <button class="small-button" @click="retryDiscordSignIn">
          Retry sign-in
        </button>
      </div>
    </template>

    <SettingsModal
      :open="settingsModalOpen"
      :invertTubes="invertTubes"
      @close="closePlaySettings"
      @invert-change="handleInvertTubesChange"
    />

    <ScoresModal :open="scoresModalOpen" @close="closeScoresModal">
      <div class="score-panel-head">
        <div>
          <p class="hint">{{ scorePanelHint }}</p>
          <p v-if="isActivity && discordError" class="hint discord-error">
            {{ discordError }}
          </p>
        </div>
        <div v-if="!isActivity" class="header-actions">
          <WalletButton size="sm" />
        </div>
        <div v-else-if="discordStatus === 'error'" class="header-actions">
          <button class="small-button" @click="retryDiscordSignIn">
            Retry sign-in
          </button>
        </div>
      </div>
      <div v-if="showUploadScore">
        <p v-if="isActivity" class="hint">
          Submitting publishes a one-way hash of your Discord ID and your
          score on the public Algorand ledger. The entry is cleared after the
          day ends, but the transaction stays in the ledger's history.
        </p>
        <button
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
      <div v-if="scoreComparison && !isActivity" class="score-actions">
        <button
          class="small-button"
          :disabled="loadingDaily || removingScore"
          @click="handleRemoveScore"
        >
          {{ removingScore ? "Removing..." : "remove score" }}
        </button>
      </div>
      <div v-if="isActivity && bestScore !== null" class="score-actions">
        <p class="hint">
          Scores submitted from Discord are kept for the day and cleared at
          midnight UTC. To record this score permanently, open the game in your
          browser and submit it with your Algorand wallet.
        </p>
        <button
          class="small-button"
          :disabled="loadingDaily"
          @click="handleKeepPermanently"
        >
          Keep permanently with a wallet
        </button>
        <button
          class="small-button"
          :disabled="loadingDaily || sharingScore || !discordIdentity"
          @click="handleShareScore"
        >
          {{ sharingScore ? "Sharing..." : "Share score to a channel" }}
        </button>
      </div>
    </ScoresModal>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { NetworkId, useNetwork, useWallet } from "@txnlab/use-wallet-vue";
import { useRoute, useRouter } from "vue-router";
import { usePlayPageStore } from "../stores/playPage";
import { useWalletStore } from "../stores/wallet";
import { useSettingsStore } from "../stores/settings";
import { useDiscordStore } from "../stores/discord";
import {
  generateScoreProof,
  getPuzzleScoreComparisonOnChain,
  getScoreUploadStatusOnChain,
  getSponsoredScoreStatusOnChain,
  removeScoreOnChain,
  saveScoreOnChain,
  type GeneratedScoreProof,
  type PuzzleScoreComparison,
} from "../algorand/puzzleScores";
import {
  MAX_SPONSORED_UPDATES,
  serializeWitness,
} from "../algorand/scoreGroups";
import { openExternalLink, shareScore } from "../discord/activity";
import { formatShareScoreMessage } from "../discord/share";
import { encodePuzzle } from "../game/serialize";
import { getTodayDateKey, parseDateKey } from "../game/daily";
import { getBestScoreMoves } from "../storage/scores";
import { movesFromQuery, puzzleFromText } from "../url/share";
import Board from "./Board.vue";
import ScoreHistogram from "./ScoreHistogram.vue";
import ScoresModal from "./ScoresModal.vue";
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
const discordStore = useDiscordStore();
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
// shallowRef: the proof holds algosdk class instances and Uint8Arrays. A deep
// ref would unwrap them into plain structural types that no longer satisfy
// GeneratedScoreProof, and deep reactivity on proof bytes is wasted work.
const precomputedProof = shallowRef<GeneratedScoreProof | null>(null);
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
const scoresModalOpen = computed(() => playStore.scoresModalOpen);
const showUploadScore = computed(() => playStore.showUploadScore);
const proofReady = computed(() => playStore.proofReady);
const proofGenerating = computed(() => playStore.proofGenerating);
const uploadingScore = computed(() => playStore.uploadingScore);
const scoreComparison = computed(() => playStore.scoreComparison);
const loadingScoreComparison = computed(() => playStore.loadingScoreComparison);
const isWalletConnected = computed(() => walletStore.isWalletConnected);
const invertTubes = computed(() => settingsStore.invertTubes);
const isActivity = computed(() => discordStore.isActivity);
const discordIdentity = computed(() => discordStore.identity);
const discordStatus = computed(() => discordStore.status);
const discordError = computed(() => discordStore.error);
const isTodaysDaily = computed(
  () =>
    playStore.dailyDateKey !== null &&
    playStore.dailyDateKey === getTodayDateKey(),
);
// Identity the proof is bound to: the Discord user key inside the Activity,
// otherwise the connected wallet address.
const proofIdentity = computed<string | Uint8Array | null>(() =>
  isActivity.value
    ? (discordIdentity.value?.userKey ?? null)
    : (activeAddress.value ?? null),
);
const proofIdentityLabel = computed(() =>
  isActivity.value
    ? (discordIdentity.value?.userId ?? null)
    : (activeAddress.value ?? null),
);
const sponsoredUpdatesExhausted = ref(false);
const sharingScore = ref(false);

// Lowest of the locally saved solve and the submitted on-chain score.
const personalBest = computed<number | null>(() => {
  const candidates = [bestScore.value, scoreComparison.value?.userScore].filter(
    (score): score is number => typeof score === "number" && score > 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : null;
});

// Lowest score anyone has recorded on-chain; only known once the player has
// submitted, because that is when the comparison is fetched.
const globalBest = computed<number | null>(() => {
  const scores = scoreComparison.value?.allScores ?? [];
  return scores.length > 0 ? Math.min(...scores) : null;
});

const scorePanelHint = computed(() => {
  if (isActivity.value) {
    if (
      discordStatus.value === "connecting" ||
      discordStatus.value === "idle"
    ) {
      return "Connecting to Discord...";
    }
    if (discordStatus.value === "error") {
      return "Discord sign-in failed.";
    }
    if (!isTodaysDaily.value) {
      return "Only today's daily puzzle can be submitted from Discord.";
    }
    if (loadingScoreComparison.value) {
      return "Loading how your recorded score compares...";
    }
    if (scoreComparison.value) {
      return formatScoreComparisonSummary(scoreComparison.value);
    }
    if (sponsoredUpdatesExhausted.value) {
      return "You have used today's free score updates.";
    }
    return "Submit your score for free to see how it compares to others";
  }
  if (!isWalletConnected.value) {
    return "Connect your Algorand wallet to submit your score and compare it to others";
  }
  if (loadingScoreComparison.value) {
    return "Loading how your recorded score compares...";
  }
  if (scoreComparison.value) {
    return formatScoreComparisonSummary(scoreComparison.value);
  }
  return "Submit your score to see how it compares to others";
});
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

function retryDiscordSignIn() {
  void discordStore.connect();
}

function openPlaySettings() {
  playStore.openPlaySettings();
}

function closePlaySettings() {
  playStore.closePlaySettings();
}

function openScoresModal() {
  playStore.openScoresModal();
}

function closeScoresModal() {
  playStore.closeScoresModal();
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
  if (isActivity.value) {
    await handleSponsoredUpload();
    return;
  }

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

interface SponsoredSubmitResponse {
  status?: "confirmed" | "pending";
  txId?: string;
  error?: string;
  code?: string;
}

async function waitForSponsoredConfirmation(txId: string): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const info = await algodClient.value
      .pendingTransactionInformation(txId)
      .do();
    if (info.poolError) {
      throw new Error(info.poolError);
    }
    if (info.confirmedRound && info.confirmedRound > 0n) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for confirmation");
}

async function handleSponsoredUpload() {
  const identity = discordIdentity.value;
  const candidateScore = playStore.bestScore ?? 0;

  if (!identity) {
    playStore.setStatus("Discord sign-in is not ready yet");
    return;
  }
  if (!isTodaysDaily.value) {
    playStore.setStatus(
      "Only today's daily puzzle can be submitted from Discord",
      4000,
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
    const response = await fetch("/api/submit-sponsored", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessToken: identity.accessToken,
        witness: serializeWitness(proofToUse.normalizedWitness),
        score: candidateScore,
      }),
    });
    const result = (await response.json()) as SponsoredSubmitResponse;

    if (!response.ok) {
      if (result.code === "update_cap") {
        sponsoredUpdatesExhausted.value = true;
      }
      const message =
        result.code === "paused"
          ? "Free submissions are paused right now. Try again later."
          : result.code === "account_age"
            ? "Your Discord account is too new for free submissions."
            : (result.error ?? "Unable to submit score");
      playStore.setStatus(message, 5000);
      return;
    }

    if (result.status === "pending" && result.txId) {
      playStore.setStatus("Submitted, waiting for confirmation...", 0);
      await waitForSponsoredConfirmation(result.txId);
    }
    playStore.setStatus("Score submitted", 3000);
  } catch (error) {
    console.warn("Unable to submit sponsored score", error);
    playStore.setStatus("Unable to submit score", 3500);
  } finally {
    playStore.setUploadingScore(false);
    await refreshOnChainScoreState();
    await refreshPrecomputedProof();
  }
}

/**
 * Opens the website in the external browser with this puzzle and the best
 * solve's move list, so the player can record the score with their wallet.
 */
async function handleKeepPermanently() {
  const currentPuzzle = playStore.startPuzzle;
  if (!currentPuzzle) {
    return;
  }
  const moves = getBestScoreMoves(currentPuzzle) ?? [];
  if (moves.length === 0) {
    playStore.setStatus("Solve the puzzle first", 3000);
    return;
  }

  const siteUrl = (
    (import.meta.env.VITE_SITE_URL as string | undefined) ??
    window.location.origin
  ).replace(/\/+$/, "");
  const query = `?moves=${encodeURIComponent(moves.join(","))}`;
  const url = playStore.dailyDateKey
    ? `${siteUrl}/${query}#${playStore.dailyDateKey}`
    : `${siteUrl}/${encodePuzzle(currentPuzzle)}${query}`;

  const opened = await openExternalLink(url);
  if (!opened) {
    playStore.setStatus("Unable to open the browser", 3000);
  }
}

/**
 * Posts the best score to a Discord channel as a `/colorsort` interaction
 * message with a button that launches the Activity.
 */
async function handleShareScore() {
  const score = bestScore.value;
  if (score === null || sharingScore.value) {
    return;
  }
  sharingScore.value = true;
  try {
    const outcome = await shareScore(
      formatShareScoreMessage({
        dateKey: playStore.dailyDateKey,
        score,
        comparison: scoreComparison.value,
      }),
    );
    if (outcome === "shared") {
      playStore.setStatus("Score shared", 3000);
    }
  } catch (cause) {
    console.error("Sharing score failed", cause);
    playStore.setStatus("Unable to share the score", 4000);
  } finally {
    sharingScore.value = false;
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
  const identity = proofIdentityLabel.value;
  if (!playStore.startPuzzle || !identity || !score || score <= 0) {
    return null;
  }

  try {
    return `${encodePuzzle(playStore.startPuzzle)}:${identity}:${score}`;
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

  const sender = proofIdentity.value;
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
      sponsored: isActivity.value,
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

async function refreshSponsoredScoreState(requestId: number) {
  const identity = discordIdentity.value;
  const currentPuzzle = playStore.startPuzzle;
  const networkId = activeNetwork.value || "mainnet";
  const candidateScore = playStore.bestScore ?? 0;

  if (
    !identity ||
    !currentPuzzle ||
    playStore.loadingDaily ||
    !isTodaysDaily.value
  ) {
    playStore.setShowUploadScore(false);
    playStore.setScoreComparison(null);
    playStore.setLoadingScoreComparison(false);
    return;
  }

  playStore.setLoadingScoreComparison(true);
  try {
    const status = await getSponsoredScoreStatusOnChain({
      networkId,
      algodClient: algodClient.value,
      userKey: identity.userKey,
      puzzle: currentPuzzle,
      score: candidateScore,
    });
    if (requestId !== scoreLookupRequestId) {
      return;
    }

    const capReached = (status.existing?.updates ?? 0) >= MAX_SPONSORED_UPDATES;
    sponsoredUpdatesExhausted.value = capReached;
    playStore.setShowUploadScore(
      candidateScore > 0 && status.status === "needs-upload" && !capReached,
    );

    if (!status.existing) {
      playStore.setScoreComparison(null);
      return;
    }

    const comparison = await getPuzzleScoreComparisonOnChain({
      networkId,
      algodClient: algodClient.value,
      userKey: identity.userKey,
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
    playStore.setShowUploadScore(candidateScore > 0);
    playStore.setScoreComparison(null);
  } finally {
    if (requestId === scoreLookupRequestId) {
      playStore.setLoadingScoreComparison(false);
    }
  }
}

async function refreshOnChainScoreState() {
  const requestId = scoreLookupRequestId + 1;
  scoreLookupRequestId = requestId;

  if (isActivity.value) {
    await refreshSponsoredScoreState(requestId);
    return;
  }

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
  if (isActivity.value) {
    // Inside Discord only today's daily puzzle is playable: ignore shared
    // puzzle codes, past dates, and imported moves from the URL.
    if (!playStore.puzzle && !playStore.loadingDaily) {
      playStore.loadTodayDaily();
    }
    return;
  }

  const importedMoves = movesFromQuery(route.query.moves);
  if (importedMoves) {
    playStore.importMoves(importedMoves);
    // Drop the moves from the URL so a reload does not re-import them.
    const nextQuery = { ...route.query };
    delete nextQuery.moves;
    void router.replace({ query: nextQuery, hash: route.hash || undefined });
  }

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
    () => discordIdentity.value,
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
    () => discordIdentity.value,
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

<style scoped>
.discord-banner {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.discord-error {
  color: #f97373;
  word-break: break-word;
}
</style>
