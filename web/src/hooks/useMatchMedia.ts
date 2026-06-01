import { createSignal, onCleanup, onMount } from 'solid-js';

export function useMatchMedia(query: string) {
  const [matches, setMatches] = createSignal(false);

  onMount(() => {
    const mq = window.matchMedia(query);
    const apply = () => setMatches(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    onCleanup(() => mq.removeEventListener('change', apply));
  });

  return matches;
}
