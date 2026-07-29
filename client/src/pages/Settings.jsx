import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, ConfirmDialog, DescriptionList, Field, Input, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useTheme } from "../context/ThemeContext";
import { formatBytes, formatDate, formatNumber, modifierKeyLabel } from "../lib/format";
import { POLICY_HINT, scorePassword } from "../lib/password";

const ACCENTS = ["#5b8cff", "#22d3ee", "#a855f7", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#818cf8"];

export default function Settings() {
  const { user, setUser, refresh, adoptToken, logout } = useAuth();
  const { overview, limits } = useWorkspace();
  const { theme, setTheme } = useTheme();
  const toast = useToast();

  const [profile, setProfile] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    accentColor: user?.accentColor || ACCENTS[0],
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const strength = useMemo(() => scorePassword(passwords.newPassword), [passwords.newPassword]);

  useEffect(() => {
    document.title = "Settings · DSMS";
  }, []);

  const dirty =
    profile.firstName !== user?.firstName ||
    profile.lastName !== user?.lastName ||
    profile.accentColor !== user?.accentColor;

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const { user: updated } = await api.auth.updateProfile(profile);
      setUser(updated);
      toast.success("Profile updated");
    } catch (error) {
      toast.fromError(error, "Could not update your profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError(null);

    if (passwords.newPassword !== passwords.confirm) {
      setPasswordError({ message: "The new passwords do not match" });
      return;
    }

    setChanging(true);
    try {
      const result = await api.auth.changePassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });

      // The change invalidated every existing token, this tab's included. Adopt
      // the replacement the server issued before making any further request.
      adoptToken(result.token);

      toast.success("Password changed", "Every other signed-in device has been signed out.");
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      await refresh();
    } catch (error) {
      setPasswordError(error);
    } finally {
      setChanging(false);
    }
  }

  /** Invalidate every token, including this one, then land back on sign-in. */
  async function signOutEverywhere() {
    setRevoking(true);
    try {
      await api.auth.logoutAll();
      toast.success("Signed out everywhere", "Every device will need to sign in again.");
      logout();
    } catch (error) {
      toast.fromError(error, "Could not sign out other sessions");
    } finally {
      setRevoking(false);
      setConfirmRevoke(false);
    }
  }

  const passwordFieldErrors = passwordError?.fieldErrors || {};

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Account</div>
          <h1 className="page-head__title">Settings</h1>
          <p className="page-head__sub">Your profile, security and interface preferences.</p>
        </div>
        <div className="page-head__actions">
          <Badge tone={user?.role === "admin" ? "violet" : undefined}>{user?.role}</Badge>
        </div>
      </div>

      <div className="grid-split">
        <div className="col gap-5">
          <section className="panel panel--flush">
            <div className="panel__header">
              <div>
                <div className="panel__title">Profile</div>
                <div className="panel__subtitle">How you appear to collaborators</div>
              </div>
            </div>

            <form className="panel__body col gap-4" onSubmit={saveProfile}>
              <div className="row gap-4">
                <span
                  className="avatar avatar--lg"
                  style={{
                    background: `linear-gradient(135deg, ${profile.accentColor}, ${profile.accentColor}88)`,
                  }}
                >
                  {user?.initials}
                </span>
                <div className="grow">
                  <div className="text-md semi">
                    {profile.firstName} {profile.lastName}
                  </div>
                  <div className="text-sm dim">{user?.email}</div>
                </div>
              </div>

              <div className="auth__row">
                <Field label="First name" htmlFor="set-first">
                  <Input
                    id="set-first"
                    value={profile.firstName}
                    onChange={(event) => setProfile({ ...profile, firstName: event.target.value })}
                    maxLength={60}
                    required
                  />
                </Field>
                <Field label="Last name" htmlFor="set-last">
                  <Input
                    id="set-last"
                    value={profile.lastName}
                    onChange={(event) => setProfile({ ...profile, lastName: event.target.value })}
                    maxLength={60}
                    required
                  />
                </Field>
              </div>

              <Field label="Accent colour" hint="Used for your avatar">
                <div className="row wrap gap-2">
                  {ACCENTS.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      aria-label={`Use ${colour}`}
                      aria-pressed={profile.accentColor === colour}
                      onClick={() => setProfile({ ...profile, accentColor: colour })}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        background: `linear-gradient(135deg, ${colour}, ${colour}88)`,
                        border:
                          profile.accentColor === colour
                            ? "2px solid var(--text)"
                            : "1px solid var(--line)",
                        boxShadow: profile.accentColor === colour ? `0 0 0 3px ${colour}33` : "none",
                        transition: "all 150ms ease",
                      }}
                    />
                  ))}
                </div>
              </Field>

              <div>
                <Button type="submit" variant="primary" icon="check" loading={savingProfile} disabled={!dirty}>
                  Save profile
                </Button>
              </div>
            </form>
          </section>

          <section className="panel panel--flush">
            <div className="panel__header">
              <div>
                <div className="panel__title">Password</div>
                <div className="panel__subtitle">{POLICY_HINT}</div>
              </div>
            </div>

            <form className="panel__body col gap-4" onSubmit={changePassword}>
              {passwordError ? (
                <Alert
                  tone="error"
                  title={passwordError.message}
                  details={passwordError.details?.filter((detail) => !detail.field)}
                />
              ) : null}

              <Field label="Current password" error={passwordFieldErrors.currentPassword} htmlFor="pw-current">
                <Input
                  id="pw-current"
                  type="password"
                  value={passwords.currentPassword}
                  onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })}
                  autoComplete="current-password"
                  icon="lock"
                  required
                />
              </Field>

              <Field
                label="New password"
                hint={passwords.newPassword ? strength.label : undefined}
                error={passwordFieldErrors.newPassword}
                htmlFor="pw-new"
              >
                <Input
                  id="pw-new"
                  type="password"
                  value={passwords.newPassword}
                  onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })}
                  autoComplete="new-password"
                  icon="lock"
                  required
                />
                {passwords.newPassword ? (
                  <div className="strength mt-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((step) => (
                      <span
                        key={step}
                        className={`strength__seg ${
                          strength.score >= step ? `strength__seg--${strength.score}` : ""
                        }`}
                      />
                    ))}
                  </div>
                ) : null}
              </Field>

              <Field label="Confirm new password" htmlFor="pw-confirm">
                <Input
                  id="pw-confirm"
                  type="password"
                  value={passwords.confirm}
                  onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                  autoComplete="new-password"
                  icon="lock"
                  required
                />
              </Field>

              <div>
                <Button
                  type="submit"
                  variant="primary"
                  icon="shield"
                  loading={changing}
                  disabled={
                    !passwords.currentPassword || !passwords.newPassword || !passwords.confirm
                  }
                >
                  Change password
                </Button>
              </div>
            </form>
          </section>

          <section className="panel panel--flush">
            <div className="panel__header">
              <div>
                <div className="panel__title">Active sessions</div>
                <div className="panel__subtitle">Revoke access on every device</div>
              </div>
            </div>
            <div className="panel__body col gap-3">
              <p className="text-sm muted">
                Signing tokens are valid until they expire, so a lost laptop or a leaked token keeps
                working on its own. This invalidates every token issued to your account immediately —
                including this browser, so you will need to sign in again.
              </p>
              <div>
                <Button variant="danger" icon="logout" onClick={() => setConfirmRevoke(true)}>
                  Sign out everywhere
                </Button>
              </div>
            </div>
          </section>
        </div>

        <div className="col gap-5">
          <section className="panel panel--flush">
            <div className="panel__header">
              <div className="panel__title">Appearance</div>
            </div>
            <div className="panel__body col gap-3">
              <Segmented
                ariaLabel="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "nebula", label: "Nebula", icon: "moon" },
                  { value: "daybreak", label: "Daybreak", icon: "sun" },
                ]}
              />
              <p className="text-xs dim">
                Saved to this browser. Defaults to your operating system preference.
              </p>
            </div>
          </section>

          <section className="panel panel--flush">
            <div className="panel__header">
              <div className="panel__title">Account</div>
            </div>
            <div className="panel__body">
              <DescriptionList
                items={[
                  { key: "Email", value: user?.email },
                  { key: "Role", value: user?.role },
                  { key: "Member since", value: formatDate(user?.createdAt) },
                  { key: "Last sign-in", value: formatDate(user?.lastLoginAt, { withTime: true }) },
                  {
                    key: "Storage quota",
                    value: overview
                      ? `${overview.storage.usedLabel} of ${overview.storage.quotaLabel} (${overview.storage.usedPercent}%)`
                      : formatBytes(user?.storageQuotaBytes),
                  },
                  {
                    key: "Documents",
                    value: overview ? formatNumber(overview.totals.documents) : null,
                  },
                ]}
              />
            </div>
          </section>

          <section className="panel panel--flush">
            <div className="panel__header">
              <div className="panel__title">Upload limits</div>
            </div>
            <div className="panel__body col gap-3">
              <DescriptionList
                items={[
                  { key: "Max file size", value: limits?.maxUploadLabel || formatBytes(limits?.maxUploadBytes) },
                  { key: "Allowed types", value: `${limits?.allowedExtensions?.length || 0} extensions` },
                ]}
              />
              {limits?.allowedExtensions?.length ? (
                <p className="text-xs dim break-word mono">{limits.allowedExtensions.join(" · ")}</p>
              ) : null}
            </div>
          </section>

          <section className="panel panel--flush">
            <div className="panel__header">
              <div className="panel__title">Keyboard shortcuts</div>
            </div>
            <div className="panel__body col gap-3 text-sm">
              {[
                { keys: [modifierKeyLabel(), "K"], label: "Command palette" },
                { keys: ["/"], label: "Focus search" },
                { keys: ["U"], label: "Open the uploader" },
                { keys: ["Esc"], label: "Close a dialog or panel" },
              ].map((shortcut) => (
                <div key={shortcut.label} className="row between gap-3">
                  <span className="muted">{shortcut.label}</span>
                  <span className="row gap-1">
                    {shortcut.keys.map((key) => (
                      <span key={key} className="kbd">
                        {key}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={signOutEverywhere}
        busy={revoking}
        title="Sign out everywhere?"
        message="Every token issued to your account will stop working immediately, including this browser. You will be returned to the sign-in screen."
        confirmLabel="Sign out everywhere"
      />
    </>
  );
}
