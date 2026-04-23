import { ParentProps } from 'solid-js';

export default function App(props: ParentProps) {
  return (
    <div class="min-h-screen bg-immich-dark-bg text-white">
      {props.children}
    </div>
  );
}
