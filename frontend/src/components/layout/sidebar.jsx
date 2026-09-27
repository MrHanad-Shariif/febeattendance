import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import Logo from "@/components/Logo.jsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isItemActive } from "./nav-config";

const ROW =
  "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

function Leaf({ item, depth, collapsed, onNavigate }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          ROW,
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
          depth > 0 && "py-1.5"
        )
      }
    >
      {Icon && <Icon className={cn("shrink-0", depth > 0 ? "h-4 w-4" : "h-[1.15rem] w-[1.15rem]")} />}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function Group({ item, depth, collapsed, onNavigate, onExpandRequest }) {
  const { pathname } = useLocation();
  const active = isItemActive(item, pathname);
  const [open, setOpen] = useState(active);
  const Icon = item.icon;

  // Keep the group containing the current page open after navigation.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const button = (
    <button
      type="button"
      onClick={() => (collapsed ? onExpandRequest?.() : setOpen((o) => !o))}
      className={cn(
        ROW,
        active ? "text-foreground" : "text-sidebar-foreground",
        "hover:bg-sidebar-accent hover:text-foreground"
      )}
      aria-expanded={open}
    >
      {Icon && (
        <Icon className={cn("h-[1.15rem] w-[1.15rem] shrink-0", active && "text-primary")} />
      )}
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{item.label}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 opacity-60 transition-transform duration-200", open && "rotate-180")} />
        </>
      )}
    </button>
  );

  return (
    <div>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <AnimatePresence initial={false}>
        {open && !collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="ml-[1.35rem] mt-1 space-y-0.5 border-l pl-2">
              {item.children.map((child) => (
                <NavItem key={child.label} item={child} depth={depth + 1} collapsed={false} onNavigate={onNavigate} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem(props) {
  return props.item.children ? <Group {...props} /> : <Leaf {...props} />;
}

export function SidebarContent({ items, collapsed = false, onNavigate, onExpandRequest }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4", collapsed && "justify-center px-2")}>
        {collapsed ? (
          <img src="/assets/logo.png" alt="FEBEMS" className="h-9 w-9 shrink-0 rounded-md object-cover object-left" />
        ) : (
          <>
            <Logo className="h-10 w-auto max-w-[120px] shrink-0" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-foreground">FEBEMS</p>
              <p className="truncate text-[11px] text-muted-foreground" title="Faculty of Engineering and Built Environment Management System">
                Faculty management system
              </p>
            </div>
          </>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <NavItem
            key={item.label}
            item={item}
            depth={0}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onExpandRequest={onExpandRequest}
          />
        ))}
      </nav>
    </div>
  );
}
