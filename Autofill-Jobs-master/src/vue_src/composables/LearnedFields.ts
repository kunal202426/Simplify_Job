import { ref, computed } from 'vue';

export interface LearnedEntry {
  rawLabel: string;
  tokens: string[];
  fieldType: string;
  value: string;
  optionsSeen: string[];
  timesUsed: number;
  lastUsed: number;
  source: string;
}
export type LearnedBank = Record<string, LearnedEntry>;

const learned = ref<LearnedBank>({});

/**
 * Read/edit/delete access to the engine's answer bank (chrome.storage.local.learnedFields),
 * so the user can correct a mis-typed learned answer or drop a bad one.
 */
export function useLearnedFields() {
  const load = () => {
    if (!chrome?.storage) return;
    chrome.storage.local.get('learnedFields', (data) => {
      learned.value = (data && data.learnedFields) || {};
    });
  };

  const persist = () =>
    new Promise<void>((resolve) => {
      if (!chrome?.storage) return resolve();
      chrome.storage.local.set({ learnedFields: learned.value }, () => resolve());
    });

  const updateValue = (hash: string, value: string) => {
    if (!learned.value[hash]) return;
    learned.value[hash] = { ...learned.value[hash], value };
    persist();
  };

  const remove = (hash: string) => {
    const next = { ...learned.value };
    delete next[hash];
    learned.value = next;
    persist();
  };

  load();

  // Sorted for stable display: most-used first, then most-recent.
  const entries = computed(() =>
    Object.entries(learned.value)
      .map(([hash, e]) => ({ hash, ...e }))
      .sort((a, b) => b.timesUsed - a.timesUsed || b.lastUsed - a.lastUsed)
  );

  return { learned, entries, count: computed(() => entries.value.length), load, updateValue, remove };
}
