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
      "bg-[#F6EFE2] text-[#2D261E] border border-[#EDE7D9]",
    gold:
      "bg-[#D4A359]/15 text-[#8F6522] border border-[#D4A359]/30",
    subtle:
      "bg-[#2D261E]/5 text-[#786F66] border border-transparent",
    outline:
      "bg-transparent text-[#2D261E] border border-[#EDE7D9]",
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
