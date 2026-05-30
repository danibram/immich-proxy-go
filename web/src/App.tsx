import { useLocation } from '@solidjs/router';
import { createEffect, ParentProps } from 'solid-js';
import { capturePageview } from '~/analytics';

export default function App(props: ParentProps) {
  const location = useLocation();

  createEffect(() => {
    location.pathname;
    capturePageview();
  });

  return (
    <div class="min-h-screen bg-immich-dark-bg text-white">
      {props.children}
    </div>
  );
}
