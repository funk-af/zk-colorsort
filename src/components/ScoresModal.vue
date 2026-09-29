<template>
  <Transition name="modal">
    <div v-if="open" class="modal-overlay" @click="close">
      <div
        class="modal scores-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scores-modal-title"
        @click.stop
      >
        <div class="modal-header">
          <h2 id="scores-modal-title">Scores</h2>
          <button class="modal-close" @click="close" aria-label="Close scores">
            x
          </button>
        </div>
        <div class="modal-body scores-modal-body">
          <slot />
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

function close() {
  emit("close");
}
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
