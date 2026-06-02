import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-mono font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default:   "bg-accent text-bg hover:bg-accent/90 glow-accent",
        secondary: "bg-surface2 text-text hover:bg-surface2/80",
        ghost:     "text-muted hover:text-text hover:bg-surface2/50",
        danger:    "bg-error/10 text-error hover:bg-error/20 border border-error/20",
        outline:   "border border-white/10 text-text hover:border-white/20 hover:bg-surface2/50",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm:      "h-7 px-3 py-1 text-xs",
        lg:      "h-11 px-6",
        icon:    "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
