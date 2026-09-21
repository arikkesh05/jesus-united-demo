"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "gold" | "subtle" | "outline";
  size?: "sm" | "md";
}

export function Badge({
  className,
  variant = "default",
  size = "md",
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    "inline-flex items-center font-medium rounded-full select-none transition-colors";

  const variantStyles = {
    default:
      "bg-[#101D2B] text-[#F8FAFC] border border-[#1E2E42]",
    gold:
      "bg-[#F59E0B]/15 text-[#E2E8F0] border border-[#F59E0B]/30",
    subtle:
      "bg-[#F8FAFC]/5 text-[#94A3B8] border border-transparent",
    outline:
      "bg-transparent text-[#F8FAFC] border border-[#1E2E42]",
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5",
  };

  return (
    <span
      className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      {...props}
    >
      {children}
    </span>
  );
}
