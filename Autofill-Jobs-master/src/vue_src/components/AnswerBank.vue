<template>
  <div class="answerBank">
    <h2 class="subheading">Learned Answers</h2>
    <p class="abHint">
      Answers the extension learned from questions you filled in manually. Edit a value to
      correct it, or remove one it got wrong.
    </p>

    <p v-if="!entries.length" class="abEmpty">
      Nothing learned yet. Fill in a question an application couldn't autofill, and it'll
      appear here for next time.
    </p>

    <div v-for="e in entries" :key="e.hash" class="abRow">
      <div class="abMeta">
        <span class="abLabel" :title="e.rawLabel">{{ e.rawLabel || '(unlabelled field)' }}</span>
        <span class="abTags">
          <span class="abTag">{{ e.fieldType }}</span>
          <span class="abTag" v-if="e.source">{{ e.source }}</span>
          <span class="abTag abCount" :title="'Used ' + e.timesUsed + ' time(s)'">×{{ e.timesUsed }}</span>
        </span>
      </div>
      <div class="abEdit">
        <input
          class="abInput"
          :value="e.value"
          @change="onEdit(e.hash, $event)"
          spellcheck="false"
        />
        <svg
          @click="remove(e.hash)"
          class="abDel"
          title="Delete this learned answer"
          xmlns="http://www.w3.org/2000/svg"
          height="20px" viewBox="0 -960 960 960" width="20px"
        >
          <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
        </svg>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { useLearnedFields } from '@/composables/LearnedFields';

export default {
  setup() {
    const { entries, updateValue, remove, load } = useLearnedFields();
    load();
    const onEdit = (hash: string, ev: Event) => {
      updateValue(hash, (ev.target as HTMLInputElement).value);
    };
    return { entries, onEdit, remove };
  },
};
</script>

<style scoped>
.answerBank {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.abHint,
.abEmpty {
  font-family: 'Lexend';
  font-weight: 300;
  font-size: 0.85rem;
  color: rgba(45, 67, 51, 0.7);
  margin: 0 0 0.5rem;
}
.abRow {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem;
  border: 0.15rem solid rgba(0, 0, 0, 0.093);
  border-radius: 0.75rem;
}
.abMeta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.abLabel {
  font-family: 'Lexend';
  font-weight: 400;
  font-size: 0.9rem;
  color: var(--c1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.abTags {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
.abTag {
  font-family: 'Lexend';
  font-weight: 300;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background-color: rgba(45, 67, 51, 0.1);
  color: var(--c1);
  padding: 0.05rem 0.4rem;
  border-radius: 0.5rem;
}
.abCount {
  background-color: var(--c1);
  color: rgb(233, 233, 233);
}
.abEdit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.abInput {
  flex: 1;
  background-color: transparent;
  border-radius: 0.75rem;
  border: 0.15rem solid rgba(0, 0, 0, 0.093);
  outline: 0;
  font-family: 'Lexend';
  font-weight: 300;
  padding: 0.4rem;
  color: var(--c1);
}
.abDel {
  cursor: pointer;
  fill: rgba(45, 67, 51, 0.55);
  flex-shrink: 0;
}
.abDel:hover {
  fill: rgb(180, 60, 60);
}
</style>
