"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "glass";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 select-none " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A359] focus-visible:ring-offset-2 " +
      "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none";

    const variantStyles = {
      primary:
        "bg-[#2D261E] text-[#FAF7EE] hover:bg-[#3D342A] shadow-sm hover:shadow active:bg-[#201B15]",
      secondary:
        "bg-[#F6EFE2] text-[#2D261E] border border-[#EDE7D9] hover:bg-[#EFE7D8]",
      ghost:
        "bg-transparent text-[#2D261E] hover:bg-[#F6EFE2]/60",
      glass:
        "bg-[#FAF7EE]/80 backdrop-blur-md border border-[#EDE7D9] text-[#2D261E] hover:bg-[#FAF7EE] shadow-sm",
    };

    const sizeStyles = {
      sm: "min-h-9 px-3 text-xs rounded-lg gap-1.5",
      md: "min-h-11 px-4 text-sm rounded-xl gap-2", // 44px touch target compliant
      lg: "min-h-12 px-6 text-base rounded-xl gap-2.5",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
