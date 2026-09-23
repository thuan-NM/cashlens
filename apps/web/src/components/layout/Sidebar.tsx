import type { ReactNode } from "react";
import { Drawer } from "antd";
import { AnimatePresence, motion } from "framer-motion";
import { NavLink } from "react-router";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/utils/cn";

const navItems = [
  { to: "/app/dashboard", label: "Tổng quan", icon: "dashboard" },
  { to: "/app/transactions", label: "Giao dịch", icon: "transactions" },
  { to: "/app/accounts", label: "Tài khoản", icon: "accounts" },
  { to: "/app/budgets", label: "Ngân sách", icon: "budgets" },
  { to: "/app/goals", label: "Dự định", icon: "goals" },
  { to: "/app/alerts", label: "Thông báo", icon: "alerts" },
  { to: "/app/email", label: "Kết nối email", icon: "email" },
  { to: "/app/ops", label: "Vận hành", icon: "ops" },
  { to: "/app/settings", label: "Cài đặt", icon: "settings" },
] as const;

const sidebarSpring = {
  type: "spring",
  stiffness: 340,
  damping: 34,
  mass: 0.8,
} as const;

function AnimatedLabel({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.span
          initial={{ opacity: 0, x: -7 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -7 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="min-w-0 overflow-hidden whitespace-nowrap"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function SidebarContent({ mobile = false }: { mobile?: boolean }) {
  const storeCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const collapsed = storeCollapsed && !mobile;
  const expanded = !collapsed;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex h-11 shrink-0 items-center overflow-hidden", collapsed ? "justify-center" : "px-2")}>
        <motion.div layout transition={sidebarSpring}>
          <Logo compact={collapsed} />
        </motion.div>
      </div>

      <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            onClick={() => mobile && setMobileNavOpen(false)}
            className="group relative block h-[44px] shrink-0 rounded-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId={mobile ? "mobile-sidebar-active" : "desktop-sidebar-active"}
                    transition={sidebarSpring}
                    className="absolute inset-0 rounded-[13px] bg-[var(--accent)] shadow-[0_9px_22px_-10px_rgba(217,119,87,.85)]"
                  />
                )}

                <motion.span
                  layout
                  transition={sidebarSpring}
                  className={cn(
                    "relative z-10 flex h-full items-center rounded-[13px] text-[12.5px] font-medium",
                    collapsed ? "justify-center" : "gap-3 px-3",
                    isActive
                      ? "font-semibold text-white"
                      : "text-[var(--muted)] transition-colors duration-200 group-hover:bg-[var(--surface-2)] group-hover:text-[var(--text)]"
                  )}
                >
                  <motion.span
                    layout
                    transition={sidebarSpring}
                    whileHover={{ scale: 1.06 }}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-200",
                      isActive ? "bg-white/12" : "group-hover:bg-[var(--surface-3)]"
                    )}
                  >
                    <Icon name={item.icon} />
                  </motion.span>

                  <AnimatedLabel visible={expanded}>{item.label}</AnimatedLabel>
                </motion.span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-[var(--border)] pt-2">
        {!mobile && (
          <button
            type="button"
            onClick={toggleSidebar}
            title={collapsed ? "Mở rộng" : "Thu gọn"}
            className={cn(
              "group mb-2 flex h-10 w-full items-center overflow-hidden rounded-xl text-[12px] font-medium text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
              collapsed ? "justify-center" : "gap-3 px-3"
            )}
          >
            <motion.span
              layout
              animate={{ rotate: collapsed ? 180 : 0 }}
              transition={sidebarSpring}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] group-hover:bg-[var(--surface-3)]"
            >
              <Icon name="collapse" />
            </motion.span>
            <AnimatedLabel visible={expanded}>Thu gọn</AnimatedLabel>
          </button>
        )}

        <motion.div
          layout
          transition={sidebarSpring}
          className={cn(
            "flex h-[52px] items-center overflow-hidden rounded-[13px] transition-colors duration-200 hover:bg-[var(--surface-2)]",
            collapsed ? "justify-center" : "gap-3 px-2"
          )}
        >
          <motion.span
            layout
            transition={sidebarSpring}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e07a3f] to-[#d2604c] text-[11px] font-bold text-white shadow-[0_7px_18px_-8px_rgba(210,96,76,.9)]"
          >
            MT
          </motion.span>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, x: -7 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -7 }}
                transition={{ duration: 0.16 }}
                className="min-w-0 whitespace-nowrap"
              >
                <div className="truncate text-[12px] font-semibold">Minh Thuận</div>
                <div className="text-[10.5px] text-[var(--faint)]">Gói cá nhân</div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 82 : 252 }}
        transition={sidebarSpring}
        className="glass-panel sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-[var(--border)] md:block"
      >
        <div className="h-full w-full px-3.5 py-[18px]">
          <SidebarContent />
        </div>
      </motion.aside>

      <Drawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        placement="left"
        width={278}
        closable={false}
        styles={{ body: { padding: "18px 14px" } }}
      >
        <SidebarContent mobile />
      </Drawer>
    </>
  );
}
