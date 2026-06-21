import { Outlet } from "react-router";
import { motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <div className="app-mesh flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <TopBar />
        <motion.main
          key="cashlens-main"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mx-auto w-full max-w-[1340px] overflow-x-hidden p-3.5 sm:p-[18px] lg:p-[26px]"
        >
          <Outlet />
        </motion.main>
      </div>
    </div>
  );
}
