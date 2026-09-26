"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "glass";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", children, ...props },
    ref,
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 select-none " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:ring-offset-2 " +
      "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none";

    const variantStyles = {
      primary:
        "bg-[#F8FAFC] text-[#0A1118] hover:bg-[#1E2E42] shadow-sm hover:shadow active:bg-[#060B12]",
      secondary:
        "bg-[#101D2B] text-[#F8FAFC] border border-[#1E2E42] hover:bg-[#16263A]",
      ghost: "bg-transparent text-[#F8FAFC] hover:bg-[#101D2B]/60",
      glass:
        "bg-[#0A1118]/80 backdrop-blur-md border border-[#1E2E42] text-[#F8FAFC] hover:bg-[#0A1118] shadow-sm",
    };

    const sizeStyles = {
      sm: "min-h-9 px-3 text-xs rounded-lg gap-1.5",
      md: "min-h-11 px-4 text-sm rounded-xl gap-2", // 44px touch target compliant
      lg: "min-h-12 px-6 text-base rounded-xl gap-2.5",
    };

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
