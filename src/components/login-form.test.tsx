// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/genesis-logo", () => ({ GenesisLogo: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth }) }));
import { LoginForm } from "./login-form";

beforeEach(() => { vi.clearAllMocks(); auth.resetPasswordForEmail.mockResolvedValue({ error: null }); });
afterEach(cleanup);

function openRecovery() {
  render(<LoginForm demoMode={false} />);
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "internal@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
}

describe("password recovery request", () => {
  it("preserves the email, hides password fields and requests a PKCE link with a neutral response", async () => {
    openRecovery();
    expect(screen.queryByLabelText("Senha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
    await screen.findByRole("status");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("internal@example.com", {
      redirectTo: `${window.location.origin}/auth/recovery`,
    });
    expect(screen.getByRole("status").textContent).toContain("Se houver uma conta");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Entrar$/ }));
    expect(screen.getByLabelText("Senha")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    [{ status: 429 }, "Muitas solicitações"],
    [{ code: "email_address_not_authorized" }, "Não foi possível enviar"],
  ])("displays delivery failures instead of claiming an email was sent", async (error, message) => {
    auth.resetPasswordForEmail.mockResolvedValue({ error });
    openRecovery();
    fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(message));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("recovers the submit button after a network failure", async () => {
    auth.resetPasswordForEmail.mockRejectedValue(new Error("offline"));
    openRecovery();
    fireEvent.click(screen.getByRole("button", { name: "Enviar link de recuperação" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Enviar link de recuperação" }).hasAttribute("disabled")).toBe(false);
  });
});
