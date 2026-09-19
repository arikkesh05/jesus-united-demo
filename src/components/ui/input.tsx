"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex w-full min-h-11 rounded-xl border bg-[#FAF7EE]/60 px-3.5 py-2 text-sm text-[#2D261E] " +
          "placeholder:text-[#786F66]/60 transition-colors duration-150 " +
          "border-[#EDE7D9] hover:border-[#D4A359]/60 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A359] focus-visible:border-transparent " +
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-red-500 focus-visible:ring-red-500",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
