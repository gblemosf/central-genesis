// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() }));
vi.mock("@/components/genesis-logo", () => ({ GenesisLogo: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth }) }));
import { ResetPasswordForm } from "./reset-password-form";

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: "recovering-user" } }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

function submit(password = "New-safe-pass-123", confirmation = password) {
  fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: confirmation } });
  fireEvent.submit(screen.getByRole("button", { name: "Salvar nova senha" }).closest("form")!);
}

describe("setting a new password", () => {
  it("does not offer password changes without a validated session", () => {
    render(<ResetPasswordForm userId={null} />);
    expect(screen.getByRole("alert").textContent).toContain("inválido");
    expect(screen.queryByRole("button", { name: "Salvar nova senha" })).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([["short", "short"], ["A-valid-password", "Different-password"]])("rejects invalid password confirmation before contacting Auth", (password, confirmation) => {
    render(<ResetPasswordForm userId="recovering-user" />);
    submit(password, confirmation);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([null, { id: "different-user" }])("blocks an expired or switched session", async user => {
    auth.getUser.mockResolvedValue({ data: { user }, error: null });
    render(<ResetPasswordForm userId="recovering-user" />);
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("expirou"));
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates using the authenticated client, clears the form and revokes refresh sessions", async () => {
    render(<ResetPasswordForm userId="recovering-user" />);
    submit();
    await screen.findByRole("status");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "New-safe-pass-123" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(screen.getByRole("link", { name: "Entrar com a nova senha" }).getAttribute("href")).toBe("/login");
  });

  it("keeps the form usable when Auth rejects a reused password", async () => {
    auth.updateUser.mockResolvedValue({ error: { code: "same_password", status: 422 } });
    render(<ResetPasswordForm userId="recovering-user" />);
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("diferente"));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
