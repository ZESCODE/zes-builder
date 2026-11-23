type BrandLogoProps = {
  className?: string;
  showWordmark?: boolean;
  label?: string;
};

export function BrandLogo({ className = 'h-9', showWordmark = true, label = 'ZESCODE' }: BrandLogoProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <img src="/zes-logo.webp" alt={`${label} logo`} className={`${className} w-auto shrink-0`} />
      {showWordmark ? (
        <span className="text-lg font-semibold tracking-tight text-bolt-elements-textPrimary">{label}</span>
      ) : null}
    </span>
  );
}
