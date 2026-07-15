"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className = "", ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={`peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-slate-300 bg-slate-200 p-0.5 transition-colors data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-6 w-6 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
});

Switch.displayName = "Switch";
