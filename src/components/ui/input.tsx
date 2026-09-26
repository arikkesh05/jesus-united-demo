"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex w-full min-h-11 rounded-xl border bg-[#0A1118]/60 px-3.5 py-2 text-sm text-[#F8FAFC] " +
            "placeholder:text-[#94A3B8]/60 transition-colors duration-150 " +
            "border-[#1E2E42] hover:border-[#F59E0B]/60 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F59E0B] focus-visible:border-transparent " +
            "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-red-500 focus-visible:ring-red-500",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
