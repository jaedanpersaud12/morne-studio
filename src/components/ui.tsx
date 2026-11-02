import { Tooltip } from "@base-ui/react/tooltip";
import { Tabs } from "@base-ui/react/tabs";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

/**
 * The Studio's small design system: thin wrappers over Base UI primitives
 * (accessible, unstyled, from the Radix/Floating UI/MUI team), styled with our tokens.
 */

export const TipProvider = ({ children }: { children: ReactNode }) => <Tooltip.Provider delay={500} closeDelay={0}>{children}</Tooltip.Provider>;

export function Tip({ label, kbd, side = "bottom", children }: { label: ReactNode; kbd?: string; side?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup className="ui-tip">{label}{kbd && <kbd className="ui-kbd">{kbd}</kbd>}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function IconButton({ label, kbd, onClick, children, active, side, className = "", ...rest }: { label: string; kbd?: string; onClick?: () => void; children: ReactNode; active?: boolean; side?: "top" | "bottom" | "left" | "right"; className?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">) {
  return (
    <Tip label={label} kbd={kbd} side={side}>
      <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`ui-icon-btn ${className}`} data-active={active || undefined} {...rest}>{children}</button>
    </Tip>
  );
}

/** Pill segmented control with a sliding indicator (Base UI Tabs). */
export function Segmented<T extends string>({ value, onChange, items, label, size = "md" }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: ReactNode; tip?: string; kbd?: string; badge?: ReactNode }[]; label: string; size?: "sm" | "md" }) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <Tabs.List className="ui-seg" data-size={size} aria-label={label}>
        {items.map((it) => {
          const tab = (
            <Tabs.Tab key={it.id} value={it.id} className="ui-seg-tab" aria-label={it.label}>
              {it.icon}<span className="ui-seg-label">{it.label}</span>{it.badge}
            </Tabs.Tab>
          );
          return it.tip ? <Tip key={it.id} label={it.tip} kbd={it.kbd}>{tab}</Tip> : tab;
        })}
        <Tabs.Indicator className="ui-seg-indicator" />
      </Tabs.List>
    </Tabs.Root>
  );
}

export function Modal({ title, description, onClose, children, wide }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-backdrop" />
        <Dialog.Popup className={`ui-dialog ${wide ? "w-[min(1100px,94vw)]" : "w-[min(500px,94vw)]"}`}>
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div>
              <Dialog.Title className="text-[15px] font-semibold tracking-tight">{title}</Dialog.Title>
              {description && <Dialog.Description className="text-xs text-[var(--muted)] mt-0.5">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="ui-icon-btn -mr-1.5" aria-label="Close"><X size={15} /></Dialog.Close>
          </div>
          <div className="px-5 pb-5 max-h-[78vh] overflow-y-auto">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="ui-kbd">{children}</kbd>;
