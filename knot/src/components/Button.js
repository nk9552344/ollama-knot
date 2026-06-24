export function Button({
  children,
  variant = "default",
  size = "md",
  disabled = false,
  className = "",
  ...props
}) {
  const sizes = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-base",
  };

  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants = {
    default: "bg-bg-active text-text-primary hover:bg-bg-hover",
    primary: "bg-accent text-bg hover:opacity-90",
    ghost: "text-text-primary hover:bg-bg-hover",
    danger: "bg-status-red text-white hover:opacity-90",
    outline:
      "border border-border bg-transparent text-text-primary hover:bg-bg-hover",
  };

  return (
    <button
      className={`${base} ${sizes[size] || sizes.md} ${variants[variant] || variants.default} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
