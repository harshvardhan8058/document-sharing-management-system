import { useEffect, useMemo, useState } from "react";
import AuthLayout from "./AuthLayout";
import { Alert, Button, Field, Input } from "../components/ui";
import { Link, useNavigate } from "../lib/router";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { meetsPolicy, POLICY_HINT, scorePassword } from "../lib/password";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);

  const strength = useMemo(() => scorePassword(form.password), [form.password]);
  const mismatch = touchedConfirm && confirm !== "" && confirm !== form.password;

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  useEffect(() => {
    document.title = "Create an account · DSMS";
    return () => {
      document.title = "DSMS · Document Sharing & Management";
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError(null);

    if (confirm !== form.password) {
      setTouchedConfirm(true);
      return;
    }

    setBusy(true);
    try {
      const { user, pendingShares } = await register(form);

      const notes = [];
      if (user.role === "admin") notes.push("You are the first account here, so you have admin rights.");
      if (pendingShares > 0) {
        notes.push(
          `${pendingShares} document${pendingShares === 1 ? "" : "s"} already shared with this address ` +
            "are waiting in “Shared with me”."
        );
      }

      toast.success(`Welcome, ${user.firstName}`, notes.join(" ") || undefined);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = error?.fieldErrors || {};
  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    meetsPolicy(form.password) &&
    confirm === form.password;

  return (
    <AuthLayout>
      <form className="auth__form" onSubmit={submit} noValidate>
        <div>
          <h2 className="auth__title">Create your account</h2>
          <p className="auth__sub">Takes about twenty seconds.</p>
        </div>

        {error ? (
          <Alert tone="error" title={error.message} details={error.details?.filter((d) => !d.field)} />
        ) : null}

        <div className="auth__row">
          <Field label="First name" error={fieldErrors.firstName} htmlFor="reg-first">
            <Input
              id="reg-first"
              value={form.firstName}
              onChange={update("firstName")}
              placeholder="Ada"
              autoComplete="given-name"
              required
              error={fieldErrors.firstName}
            />
          </Field>

          <Field label="Last name" error={fieldErrors.lastName} htmlFor="reg-last">
            <Input
              id="reg-last"
              value={form.lastName}
              onChange={update("lastName")}
              placeholder="Sterling"
              autoComplete="family-name"
              required
              error={fieldErrors.lastName}
            />
          </Field>
        </div>

        <Field label="Work email" error={fieldErrors.email} htmlFor="reg-email">
          <Input
            id="reg-email"
            type="email"
            value={form.email}
            onChange={update("email")}
            placeholder="ada@company.com"
            autoComplete="email"
            required
            icon="users"
            error={fieldErrors.email}
          />
        </Field>

        <Field
          label="Password"
          hint={form.password ? strength.label : POLICY_HINT}
          error={fieldErrors.password}
          htmlFor="reg-password"
        >
          <Input
            id="reg-password"
            type="password"
            value={form.password}
            onChange={update("password")}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            icon="lock"
            error={fieldErrors.password}
          />
          {form.password ? (
            <div className="strength mt-1" aria-hidden="true">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={`strength__seg ${strength.score >= step ? `strength__seg--${strength.score}` : ""}`}
                />
              ))}
            </div>
          ) : null}
        </Field>

        <Field label="Confirm password" error={mismatch ? "Passwords do not match" : undefined} htmlFor="reg-confirm">
          <Input
            id="reg-confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouchedConfirm(true)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            icon="lock"
            error={mismatch}
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!canSubmit}
          block
          iconRight="arrowRight"
        >
          Create account
        </Button>

        <p className="auth__alt">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
