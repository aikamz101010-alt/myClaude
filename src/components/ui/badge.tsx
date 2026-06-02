import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-accent/10 text-accent border border-accent/20",
        running: "bg-accent/10 text-accent border border-accent/20 animate-pulse",
        idle:    "bg-surface2 text-muted border border-white/5",
        error:   "bg-error/10 text-error border border-error/20",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
