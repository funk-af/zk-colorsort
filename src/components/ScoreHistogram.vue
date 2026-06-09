<template>
  <div class="score-histogram" aria-label="Histogram of recorded scores">
    <div v-for="bucket in buckets" :key="bucket.score" class="histogram-column">
      <span class="histogram-count">{{ bucket.count }}</span>
      <div class="histogram-track">
        <div
          :class="`histogram-bar${bucket.includesUser ? ' mine' : ''}`"
          :style="{ height: getHeight(bucket.count) }"
          :title="`${bucket.score} moves: ${bucket.count} score${bucket.count === 1 ? '' : 's'}`"
        />
      </div>
      <span class="histogram-label">{{ bucket.score }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PuzzleScoreComparison } from "../algorand/puzzleScores";

interface HistogramBucket {
  score: number;
  count: number;
  includesUser: boolean;
}

const props = defineProps<{
  comparison: PuzzleScoreComparison;
}>();

function buildBuckets(comparison: PuzzleScoreComparison): HistogramBucket[] {
  const counts = new Map<number, number>();
  for (const score of comparison.allScores) {
    counts.set(score, (counts.get(score) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([score, count]) => ({
      score,
      count,
      includesUser: score === comparison.userScore,
    }));
}

const buckets = computed(() => buildBuckets(props.comparison));

const maxCount = computed(() => {
  return buckets.value.reduce(
    (highest, bucket) => Math.max(highest, bucket.count),
    0,
  );
});

function getHeight(count: number): string {
  return maxCount.value > 0 ? `${(count / maxCount.value) * 100}%` : "0%";
}
</script>
