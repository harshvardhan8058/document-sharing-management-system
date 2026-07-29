import { useState } from "react";
import AuthLayout from "./AuthLayout";
import { Alert, Button, Field, Input } from "../components/ui";
import { Link, useNavigate } from "../lib/router";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const DEMO = { email: "admin@dsms.dev", password: "Admin@12345" };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { user } = await login(form);
      toast.success(`Welcome back, ${user.firstName}`);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = error?.fieldErrors || {};

  return (
    <AuthLayout>
      <form className="auth__form" onSubmit={submit} noValidate>
        <div>
          <h2 className="auth__title">Sign in</h2>
          <p className="auth__sub">Enter your credentials to reach your document vault.</p>
        </div>

        {error ? (
          <Alert tone="error" title={error.message} details={error.details?.filter((d) => !d.field)} />
        ) : null}

        <Field label="Email" error={fieldErrors.email} htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            value={form.email}
            onChange={update("email")}
            placeholder="you@company.com"
            autoComplete="email"
            required
            icon="users"
            error={fieldErrors.email}
          />
        </Field>

        <Field label="Password" error={fieldErrors.password} htmlFor="login-password">
          <Input
            id="login-password"
            type="password"
            value={form.password}
            onChange={update("password")}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            icon="lock"
            error={fieldErrors.password}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} block iconRight="arrowRight">
          Sign in
        </Button>

        <p className="auth__alt">
          No account yet? <Link to="/register">Create one</Link>
        </p>

        <div className="auth__demo">
          <span className="row between gap-2">
            <strong className="semi">Seeded demo account</strong>
            <button
              type="button"
              className="link-quiet text-xs"
              onClick={() => setForm({ email: DEMO.email, password: DEMO.password })}
            >
              Fill in
            </button>
          </span>
          <span className="mono">
            {DEMO.email} · {DEMO.password}
          </span>
          <span className="dim">
            Available after running <span className="mono">npm run seed</span>. The very first account
            created on a fresh install becomes the admin.
          </span>
        </div>
      </form>
    </AuthLayout>
  );
}
