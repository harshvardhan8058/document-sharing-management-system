import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  CopyField,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Spinner,
  Tabs,
} from "./ui";
import { Icon } from "../lib/icons";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { formatDate, permissionLabel, relativeTime } from "../lib/format";

const EXPIRY_CHOICES = [
  { value: "", label: "Never expires" },
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/**
 * Sharing control panel.
 *
 * Two independent mechanisms behind one dialog:
 *  - People: named grants, resolved by email so you can invite someone who has
 *    not signed up yet.
 *  - Link: anonymous access with optional password, expiry and download cap.
 */
export default function ShareDialog({ open, onClose, document: doc, onChanged }) {
  const toast = useToast();

  const [tab, setTab] = useState("people");
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);

  // invite form
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState("view");
  const [inviteExpiry, setInviteExpiry] = useState("");
  const [inviting, setInviting] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  // link form
  const [linkPermission, setLinkPermission] = useState("view");
  const [linkPassword, setLinkPassword] = useState("");
  const [linkExpiry, setLinkExpiry] = useState("30");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);

  const load = useCallback(async () => {
    if (!doc) return;
    setLoading(true);
    try {
      const { shares: list } = await api.shares.list(doc.id);
      setShares(list);
    } catch (error) {
      toast.fromError(error, "Could not load sharing settings");
    } finally {
      setLoading(false);
    }
  }, [doc, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setPermission("view");
      setInviteExpiry("");
      setLinkPassword("");
      setLinkExpiry("30");
      setMaxDownloads("");
      setSuggestions([]);
      setTab("people");
    }
  }, [open]);

  // Directory lookup, debounced so typing an address does not spam the API.
  useEffect(() => {
    if (!open || email.trim().length < 2) {
      setSuggestions([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        const { users } = await api.auth.directory(email.trim());
        setSuggestions(users.slice(0, 5));
      } catch {
        setSuggestions([]);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [email, open]);

  async function invite(event) {
    event?.preventDefault();
    if (!email.trim()) return;

    setInviting(true);
    try {
      const result = await api.shares.invite(doc.id, {
        email: email.trim(),
        permission,
        ...(inviteExpiry ? { expiresInDays: Number(inviteExpiry) } : {}),
      });

      toast.success(
        `Shared with ${email.trim()}`,
        result.pending ? "They will get access as soon as they create an account." : undefined
      );
      setEmail("");
      setSuggestions([]);
      await load();
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Could not share this document");
    } finally {
      setInviting(false);
    }
  }

  async function createLink() {
    setCreatingLink(true);
    try {
      const { share } = await api.shares.createLink(doc.id, {
        permission: linkPermission,
        ...(linkPassword ? { password: linkPassword } : {}),
        ...(linkExpiry ? { expiresInDays: Number(linkExpiry) } : {}),
        ...(maxDownloads ? { maxDownloads: Number(maxDownloads) } : {}),
      });

      toast.success("Public link created", "Copy it from the list below.");
      setLinkPassword("");
      setMaxDownloads("");
      setShares((current) => [share, ...current]);
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Could not create the link");
    } finally {
      setCreatingLink(false);
    }
  }

  async function revoke(share) {
    try {
      await api.shares.revoke(doc.id, share.id);
      setShares((current) => current.filter((item) => item.id !== share.id));
      toast.success(share.type === "link" ? "Link revoked" : `Access removed for ${share.email}`);
      onChanged?.();
    } catch (error) {
      toast.fromError(error, "Could not revoke access");
    }
  }

  const peopleShares = shares.filter((share) => share.type === "user");
  const linkShares = shares.filter((share) => share.type === "link");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share"
      subtitle={doc?.title}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "people", label: "People", count: peopleShares.length },
          { value: "link", label: "Public links", count: linkShares.length },
        ]}
      />

      {tab === "people" ? (
        <>
          <form className="col gap-3" onSubmit={invite}>
            <Field label="Invite by email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                icon="users"
                autoComplete="off"
              />
            </Field>

            {suggestions.length ? (
              <div className="col gap-1">
                {suggestions.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="palette__item"
                    onClick={() => {
                      setEmail(user.email);
                      setSuggestions([]);
                    }}
                  >
                    <Avatar name={user.fullName} color={user.accentColor} size="sm" />
                    <span className="grow truncate">
                      <span className="semi">{user.fullName}</span>
                      <span className="dim"> · {user.email}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="row gap-3 wrap">
              <div className="grow" style={{ minWidth: 150 }}>
                <Field label="Permission">
                  <Select value={permission} onChange={(event) => setPermission(event.target.value)}>
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                    <option value="manage">Can manage</option>
                  </Select>
                </Field>
              </div>
              <div className="grow" style={{ minWidth: 150 }}>
                <Field label="Access expires">
                  <Select value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)}>
                    {EXPIRY_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>

            <Button type="submit" variant="primary" icon="plus" loading={inviting} disabled={!email.trim()}>
              Grant access
            </Button>
          </form>

          <hr className="divider" />

          {loading ? (
            <div className="row center" style={{ padding: 20 }}>
              <Spinner />
            </div>
          ) : peopleShares.length ? (
            <div className="col gap-2">
              {peopleShares.map((share) => (
                <div key={share.id} className="row gap-3" style={{ padding: "6px 0" }}>
                  <Avatar email={share.email} size="sm" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="text-sm semi truncate">{share.email}</div>
                    <div className="text-xs dim">
                      {permissionLabel(share.permission)}
                      {share.expiresAt ? ` · expires ${formatDate(share.expiresAt)}` : ""}
                      {!share.userId ? " · awaiting sign-up" : ""}
                    </div>
                  </div>
                  {share.isExpired ? <Badge tone="danger">Expired</Badge> : null}
                  <IconButton
                    icon="close"
                    label={`Remove access for ${share.email}`}
                    onClick={() => revoke(share)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm dim">Not shared with anyone yet.</p>
          )}
        </>
      ) : (
        <>
          <Alert tone="info">
            Anyone holding a public link can open this document without signing in. Add a password or an
            expiry to keep control.
          </Alert>

          <div className="row gap-3 wrap">
            <div className="grow" style={{ minWidth: 140 }}>
              <Field label="Permission">
                <Select value={linkPermission} onChange={(event) => setLinkPermission(event.target.value)}>
                  <option value="view">Can view</option>
                  <option value="edit">Can edit</option>
                </Select>
              </Field>
            </div>
            <div className="grow" style={{ minWidth: 140 }}>
              <Field label="Expires">
                <Select value={linkExpiry} onChange={(event) => setLinkExpiry(event.target.value)}>
                  {EXPIRY_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          <div className="row gap-3 wrap">
            <div className="grow" style={{ minWidth: 140 }}>
              <Field label="Password" hint="Optional, min 4 chars">
                <Input
                  type="password"
                  value={linkPassword}
                  onChange={(event) => setLinkPassword(event.target.value)}
                  placeholder="No password"
                  icon="lock"
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <div className="grow" style={{ minWidth: 140 }}>
              <Field label="Download limit" hint="Optional">
                <Input
                  type="number"
                  min="1"
                  max="100000"
                  value={maxDownloads}
                  onChange={(event) => setMaxDownloads(event.target.value)}
                  placeholder="Unlimited"
                  icon="download"
                />
              </Field>
            </div>
          </div>

          <Button variant="primary" icon="link" onClick={createLink} loading={creatingLink}>
            Create public link
          </Button>

          <hr className="divider" />

          {loading ? (
            <div className="row center" style={{ padding: 20 }}>
              <Spinner />
            </div>
          ) : linkShares.length ? (
            <div className="col gap-3">
              {linkShares.map((share) => (
                <div key={share.id} className="col gap-2">
                  <div className="row between gap-2">
                    <span className="row gap-2 text-xs">
                      <Badge tone={share.isExpired ? "danger" : "accent"} icon="link">
                        {permissionLabel(share.permission)}
                      </Badge>
                      {share.hasPassword ? <Badge icon="lock">Password</Badge> : null}
                      {share.maxDownloads ? (
                        <Badge tone={share.downloadCount >= share.maxDownloads ? "danger" : undefined}>
                          {share.downloadCount}/{share.maxDownloads} downloads
                        </Badge>
                      ) : (
                        <Badge>{share.downloadCount} downloads</Badge>
                      )}
                    </span>
                    <IconButton icon="close" label="Revoke this link" onClick={() => revoke(share)} />
                  </div>

                  <CopyField value={share.url} label="share link" />

                  <div className="text-xs dim">
                    {share.expiresAt ? `Expires ${formatDate(share.expiresAt)}` : "No expiry"}
                    {share.lastAccessedAt ? ` · last opened ${relativeTime(share.lastAccessedAt)}` : " · never opened"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm dim row gap-2">
              <Icon name="info" size={14} /> No public links yet.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
