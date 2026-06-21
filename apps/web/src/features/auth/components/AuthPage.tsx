import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Checkbox, Form, Input, Segmented } from "antd";
import { motion } from "framer-motion";
import { Logo } from "@/components/ui/Logo";
import { useAuthStore } from "@/stores/authStore";

function ProductPreview() {
  return (
    <div className="relative mt-7 max-w-[380px]">
      <div className="absolute -inset-x-3 inset-y-4 rounded-[20px] bg-black/25 blur-sm" />
      <div className="animate-float relative rounded-[20px] border border-white/20 bg-white/10 p-5 text-white shadow-[0_30px_60px_-24px_rgba(0,0,0,.55)] backdrop-blur-2xl">
        <div className="flex items-center justify-between text-[11px] text-white/65">
          <span className="flex items-center gap-2"><span className="h-[7px] w-[7px] rounded-full bg-[#62b88c] ring-[3px] ring-[#62b88c]/25" />Số dư ròng · Tháng 6</span>
          <span className="rounded-md bg-[#62b88c]/15 px-2 py-1 font-semibold text-[#62b88c]">▲ 8%</span>
        </div>
        <div className="mt-3 text-[30px] font-bold tracking-tight tabular-nums">+7.200.000₫</div>
        <svg viewBox="0 0 320 56" className="my-3 h-12 w-full overflow-visible">
          <path d="M0 42 L46 36 L92 40 L137 24 L183 30 L229 14 L274 19 L320 6" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="320" cy="6" r="3.4" fill="white" />
        </svg>
        <div className="space-y-3 border-t border-white/15 pt-3.5 text-[11.5px]">
          {[["Highlands Coffee", "Cà phê · TCB", "−78.000₫", "#D97757"], ["Lương tháng 6", "Thu nhập · VCB", "+24.500.000₫", "#62b88c"]].map((item) => (
            <div key={item[0]} className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-[9px]" style={{ background: `${item[3]}44` }} />
              <div className="min-w-0 flex-1"><div className="font-semibold">{item[0]}</div><div className="text-white/50">{item[1]}</div></div>
              <div className="font-bold tabular-nums" style={{ color: item[3] === "#62b88c" ? item[3] : "white" }}>{item[2]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const submit = () => {
    login({ name: "Minh Thuận", email: "thuan.nguyen@gmail.com" });
    navigate("/app/dashboard");
  };

  return (
    <div className="app-mesh flex min-h-screen">
      <section className="relative hidden flex-1 overflow-hidden bg-[radial-gradient(120%_80%_at_88%_6%,rgba(217,119,87,.5),transparent_56%),radial-gradient(90%_70%_at_6%_104%,rgba(217,119,87,.22),transparent_52%),linear-gradient(158deg,#34261d_0%,#241a14_58%,#1b130d_100%)] p-[clamp(28px,4vw,52px)] lg:flex lg:flex-col lg:justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,.05)_1px,transparent_0)] bg-[size:22px_22px]" />
        <div className="absolute left-[clamp(28px,4vw,52px)] top-[clamp(24px,4vw,44px)]"><Logo inverse /></div>
        <div className="relative z-10 max-w-[520px]">
          <div className="font-editorial text-[19px] italic text-white/75">Tài chính của bạn, tự kể chuyện.</div>
          <h1 className="mt-3 text-[clamp(32px,4vw,44px)] font-bold leading-[1.08] tracking-[-.035em] text-white">Mỗi email ngân hàng,<br />một giao dịch rõ ràng.</h1>
          <p className="mt-4 max-w-[450px] text-[13.5px] leading-6 text-white/70">Tự đọc email biến động số dư, bóc tách giao dịch, phân loại thu–chi và cảnh báo trước khi bạn vượt ngân sách — không cần nhập tay.</p>
          <ProductPreview />
        </div>
        <div className="absolute bottom-8 left-[clamp(28px,4vw,52px)] flex flex-wrap gap-2">
          {["Vietcombank", "Techcombank", "MB Bank", "ACB", "+12 ngân hàng"].map((bank) => <span key={bank} className="rounded-[9px] border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80">{bank}</span>)}
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} className="glass-panel w-full max-w-[410px] rounded-[20px] border p-5 shadow-[0_30px_70px_-28px_rgba(48,45,40,.4)] sm:p-7">
          <div className="mb-4 lg:hidden"><Logo /></div>
          <h2 className="text-[20px] font-bold tracking-tight">{mode === "login" ? "Chào mừng trở lại" : "Bắt đầu với CashLens"}</h2>
          <p className="mt-1 text-[12px] text-[var(--faint)]">{mode === "login" ? "Đăng nhập để xem bức tranh tài chính của bạn" : "Tạo tài khoản miễn phí trong 30 giây"}</p>
          <Segmented block className="mt-5" value={mode} onChange={(value) => setMode(value as typeof mode)} options={[{ label: "Đăng nhập", value: "login" }, { label: "Tạo tài khoản", value: "register" }]} />
          <Button block className="mt-4" onClick={submit}><span className="h-[18px] w-[18px] rounded-full bg-[conic-gradient(#ea4335,#fbbc05,#34a853,#4285f4,#ea4335)]" />Tiếp tục với Google</Button>
          <div className="my-4 flex items-center gap-3 text-[11px] text-[var(--faint)]"><span className="h-px flex-1 bg-[var(--border)]" />hoặc dùng email<span className="h-px flex-1 bg-[var(--border)]" /></div>
          <Form layout="vertical" requiredMark={false} onFinish={submit}>
            {mode === "register" && <Form.Item label="Họ và tên" name="name"><Input placeholder="Nguyễn Minh Thuận" /></Form.Item>}
            <Form.Item label="Email" name="email" initialValue="thuan.nguyen@gmail.com"><Input /></Form.Item>
            <Form.Item label="Mật khẩu" name="password" initialValue="demo1234"><Input.Password /></Form.Item>
            <div className="mb-4 flex items-center justify-between text-[11.5px]"><Checkbox defaultChecked>Ghi nhớ đăng nhập</Checkbox><button type="button" className="font-semibold text-[var(--accent)]">Quên mật khẩu?</button></div>
            <Button htmlType="submit" type="primary" block>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Button>
          </Form>
          <button onClick={submit} className="mt-2 w-full py-1 text-[12px] font-semibold text-[var(--accent)]">Dùng thử bản demo →</button>
          <p className="mt-4 border-t border-[var(--border)] pt-4 text-center text-[10.5px] leading-relaxed text-[var(--faint)]">OAuth chỉ đọc · CashLens không bao giờ thấy mật khẩu ngân hàng</p>
        </motion.div>
      </section>
    </div>
  );
}
