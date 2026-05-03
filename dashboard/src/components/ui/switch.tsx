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
      className={`peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-[#2b2b2f] bg-[#101214] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] transition-colors data-[state=checked]:border-[#d1ff00]/60 data-[state=checked]:bg-[#171e06] data-[state=unchecked]:bg-[#121416] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1ff00]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-[#5a616f] shadow-lg transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-[#d1ff00] data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
});

Switch.displayName = "Switch";
