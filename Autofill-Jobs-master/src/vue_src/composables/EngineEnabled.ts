import { ref, computed } from 'vue';

const STORAGE_KEY = 'afjEngineEnabled';
// Undefined (never touched) means enabled — matches the content script's own default, so a
// fresh install works immediately without an opt-in click.
const enabled = ref(true);
let loaded = false;

export function useEngineEnabled() {
  const load = () => {
    if (loaded || !chrome.storage) return;
    loaded = true;
    chrome.storage.sync.get([STORAGE_KEY], (data) => {
      enabled.value = data[STORAGE_KEY] !== false;
    });
  };

  const setEnabled = (value: boolean) => {
    enabled.value = value;
    if (!chrome.storage) return;
    chrome.storage.sync.set({ [STORAGE_KEY]: value });
  };

  const toggle = () => setEnabled(!enabled.value);

  return {
    enabled: computed(() => enabled.value),
    setEnabled,
    toggle,
    load,
  };
}
