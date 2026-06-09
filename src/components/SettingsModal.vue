<template>
  <Transition name="modal">
    <div v-if="open" class="modal-overlay" @click="close">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h2>Settings</h2>
          <button
            class="modal-close"
            @click="close"
            aria-label="Close settings"
          >
            x
          </button>
        </div>
        <div class="modal-body">
          <div class="settings-row">
            <label>
              <input
                type="checkbox"
                :checked="invertTubes"
                @change="
                  (event: Event) =>
                    $emit(
                      'invert-change',
                      (event.target as HTMLInputElement).checked,
                    )
                "
              />
              Invert tubes
            </label>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean;
  invertTubes: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "invert-change": [value: boolean];
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
