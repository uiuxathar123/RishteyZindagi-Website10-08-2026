import { cn } from "@/lib/utils";
import Link from "next/link";
import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "ghost" | "link";
type Size = "sm" | "md" | "lg";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-rz-maroon text-white shadow-[0_10px_24px_-8px_rgba(165,30,59,0.5)] hover:bg-rz-maroon-dark hover:shadow-[0_14px_30px_-8px_rgba(165,30,59,0.6)]",
  outline:
    "bg-white text-rz-maroon border border-rz-maroon hover:bg-rz-maroon/5",
  ghost: "bg-transparent text-rz-navy hover:bg-rz-navy/5",
  link: "bg-transparent text-rz-muted hover:text-rz-maroon px-1 py-1",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-4 text-sm gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-[52px] px-7 text-base gap-2.5",
};

const base =
  "rz-focus inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap transition-all duration-200 ease-rz active:translate-y-px disabled:opacity-50 disabled:pointer-events-none";

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "left",
  fullWidth,
  className,
  children,
  ...rest
}: BaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        base,
        variantClasses[variant],
        variant !== "link" && sizeClasses[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {icon && iconPosition === "left" ? icon : null}
      {children}
      {icon && iconPosition === "right" ? icon : null}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "left",
  fullWidth,
  className,
  children,
}: BaseProps & { href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        base,
        variantClasses[variant],
        variant !== "link" && sizeClasses[size],
        fullWidth && "w-full",
        className
      )}
    >
      {icon && iconPosition === "left" ? icon : null}
      {children}
      {icon && iconPosition === "right" ? icon : null}
    </Link>
  );
}
