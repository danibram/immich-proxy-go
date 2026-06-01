import { useLocation } from '@solidjs/router';
import { createEffect, createMemo, ParentProps } from 'solid-js';
import { capturePageview } from '~/analytics';

export default function App(props: ParentProps) {
  const location = useLocation();

  const isShareRoute = createMemo(() => {
    const path = location.pathname;
    return path.startsWith('/share/') || path.startsWith('/s/');
  });

  createEffect(() => {
    location.pathname;
    capturePageview();
  });

  return (
    <div class={isShareRoute() ? 'app-share' : 'app-landing'}>
      {props.children}
    </div>
  );
}
