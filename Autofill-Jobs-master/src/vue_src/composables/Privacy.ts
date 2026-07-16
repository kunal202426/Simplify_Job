
import { ref, computed } from 'vue';

const privacy = ref(false);

export function usePrivacy() {
  const togglePrivacy = () => {
    privacy.value = !privacy.value;
  };
  const setPrivacy = (value:boolean) => {
    privacy.value = value;
  };
 
  return {
    privacy: computed(() => privacy.value), 
    togglePrivacy,
    setPrivacy
  };
}
