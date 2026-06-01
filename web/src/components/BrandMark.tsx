interface Props {
  class?: string;
  size?: number;
}

export default function BrandMark(props: Props) {
  const size = () => props.size ?? 27;
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="13" stroke="var(--accent)" stroke-width="2.4" />
      <circle cx="16" cy="16" r="5" fill="var(--accent)" />
    </svg>
  );
}
