
import { ref, computed } from 'vue';

const isOn = ref(false);

export function useSkills() {
  const toggleIsOn = () => {
    isOn.value = !isOn.value;
  };
  return {
    isOn: computed(() => isOn.value), 
    toggleIsOn
  };
}
