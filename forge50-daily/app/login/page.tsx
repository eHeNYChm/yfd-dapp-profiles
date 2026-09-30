import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="shell login">
      <h1 className="wordmark">Forge 50 Daily</h1>
      <LoginForm />
    </main>
  );
}
