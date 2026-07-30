/**
 * What the interface has to actually do, checked in a real browser.
 *
 * These are behaviours, not renders: a class name being present proves nothing,
 * so the keyboard cursor is verified by comparing computed styles, the live
 * notification by watching a badge change without a navigation, and the service
 * worker by reading what it put in the cache.
 */

export async function runChecks({ page, base, report, shot }) {
  const { section, check } = report;

  /**
   * Open the library and wait until it has actually rendered.
   *
   * Every keystroke below acts on the loaded list, and an assertion that counts
   * cards is meaningless before the first fetch resolves — "no results" and "not
   * loaded yet" look identical in the DOM.
   */
  const openLibrary = async (pathname = "/documents") => {
    await page.goto(`${base}${pathname}`);
    await page.waitFor("document.querySelectorAll('article.doc-card').length > 0", { label: "the library to load" });
  };

  const signIn = async (email, password) => {
    await page.goto(base);
    await page.fill("#login-email", email);
    await page.fill("#login-password", password);
    await page.click("button[type=submit]");
    await page.waitFor("Boolean(localStorage['dsms.token'])", { label: "a stored session" });
    await openLibrary();
  };

  // ------------------------------------------------------------------ sign in
  section("Sign in");
  await page.goto(base);
  check("the sign-in screen renders", await page.eval("document.querySelectorAll('input').length >= 2"));
  check(
    "the stylesheet is applied, not just the markup",
    (await page.eval("getComputedStyle(document.body).backgroundColor")) !== "rgba(0, 0, 0, 0)"
  );
  await shot("01-sign-in");

  check(
    "a wrong password is refused",
    await page.eval(`
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@dsms.dev', password: 'not-the-password' }) });
      return res.status === 401;
    `)
  );
  await signIn("admin@dsms.dev", "Admin@12345");
  check("valid credentials sign in and store a session", await page.eval("Boolean(localStorage['dsms.token'])"));

  // ---------------------------------------------------------------- dashboard
  section("Dashboard");
  await page.goto(base);
  const metrics = await page.eval("document.querySelector('main').innerText.replace(/\\n+/g,' / ').slice(0,120)");
  check("metrics render with real numbers", /\d/.test(metrics), metrics.slice(0, 80));
  check("the animated backdrop is mounted", await page.eval("Boolean(document.querySelector('[class*=backdrop],[class*=aurora]'))"));
  await shot("02-dashboard");

  // ------------------------------------------------------- keyboard behaviour
  section("Library and keyboard navigation");
  await page.goto(`${base}/documents`);
  const tiles = await page.waitFor("document.querySelectorAll('article.doc-card').length || 0", { label: "document tiles" });
  check("the seeded documents are listed", tiles === 5, `${tiles} tiles`);

  const restingStyle = await page.eval(`
    const s = getComputedStyle(document.querySelector('article.doc-card'));
    return s.borderColor + '||' + s.boxShadow;
  `);
  await page.press("ArrowRight");
  await page.waitFor("Boolean(document.querySelector('.doc-card.card-focused'))", { label: "the keyboard cursor" });
  await page.press("ArrowLeft");
  await page.waitFor("document.querySelector('article.doc-card').classList.contains('card-focused')", {
    label: "the cursor to come back to the first card",
  });
  const cursorStyle = await page.eval(`
    const el = document.querySelector('article.doc-card');
    const s = getComputedStyle(el);
    return el.classList.contains('card-focused') + '||' + s.borderColor + '||' + s.boxShadow;
  `);
  check("an arrow key moves the cursor onto a card", cursorStyle.startsWith("true"));
  check(
    "and the cursor is visibly drawn, not just a class name",
    cursorStyle.split("||")[1] !== restingStyle.split("||")[0] &&
      cursorStyle.split("||")[2] !== restingStyle.split("||")[1],
    cursorStyle.split("||")[1]
  );

  await page.press(" ");
  const firstPreview = await page.waitFor(
    "(document.querySelector('[role=dialog]')?.innerText || '').replace(/\\n+/g,' / ').slice(0,60)",
    { label: "Quick Look" }
  );
  check("Space opens Quick Look on the cursored document", Boolean(firstPreview), firstPreview);
  await shot("03-quick-look");
  await page.press("ArrowRight");
  const secondPreview = await page.eval(
    "(document.querySelector('[role=dialog]')?.innerText || '').replace(/\\n+/g,' / ').slice(0,60)"
  );
  check("arrows move between documents inside Quick Look", secondPreview !== firstPreview, secondPreview);
  await page.press("Escape");
  check(
    "Escape closes it",
    await page.waitFor("document.querySelectorAll('[role=dialog]').length === 0", { label: "Quick Look to close" })
  );

  section("Shortcuts");
  await page.press("/");
  check("'/' focuses the search field", (await page.eval("document.activeElement.type")) === "search");
  await page.press("Escape");
  await page.eval("document.activeElement.blur()");
  await page.press("k", { ctrl: true });
  check(
    "Ctrl/Cmd+K opens the command palette",
    await page.waitFor("document.querySelectorAll('[role=dialog]').length > 0", { label: "the command palette" })
  );
  await shot("04-command-palette");
  await page.press("Escape");

  section("Header search");
  await page.eval("document.querySelector('header input[type=search]').focus()");
  await page.fill("header input[type=search]", "roadmap");
  await page.press("Enter");
  await page.waitFor("location.search.includes('search=roadmap')", { label: "the search to reach the URL" });
  check("submitting it filters the library through the URL", true, await page.eval("location.pathname + location.search"));
  check(
    "and only the matching document comes back",
    (await page.eval("document.querySelectorAll('article.doc-card').length")) === 1,
    await page.eval("[...document.querySelectorAll('.doc-card__title')].map(t=>t.innerText).join(' | ')")
  );

  // -------------------------------------------------------- bulk actions/undo
  section("Selection and bulk actions");
  await openLibrary();
  await page.press("ArrowRight");
  // `x` acts on the cursored card, so the cursor has to exist before pressing it.
  await page.waitFor("Boolean(document.querySelector('.doc-card.card-focused'))", { label: "the keyboard cursor" });
  await page.press("x");
  const oneSelected = await page.waitFor(
    "(document.querySelector('[class*=bulk]')?.innerText || '').replace(/\\s+/g,' ')",
    { label: "the bulk bar" }
  );
  check("X selects the cursored document and raises the bulk bar", /1 document selected/.test(oneSelected));
  await page.press("a", { ctrl: true });
  const allSelected = await page.waitFor(
    "/5 documents selected/.test(document.querySelector('[class*=bulk]')?.innerText || '') && document.querySelector('[class*=bulk]').innerText.replace(/\\s+/g,' ')",
    { label: "a full-page selection" }
  );
  check("Ctrl/Cmd+A selects the whole page", Boolean(allSelected));
  await shot("05-bulk-selection");

  await page.clickText("[class*=bulk] button", "trash");
  await page.waitFor("document.querySelectorAll('article.doc-card').length === 0", { label: "the bulk trash to apply" });
  check("a bulk action applies to every selected document", true);
  check("and offers Undo instead of demanding confirmation first", await page.eval("/undo/i.test(document.body.innerText)"));
  await shot("06-undo");
  await page.clickText("button", "undo");
  await page.waitFor("document.querySelectorAll('article.doc-card').length === 5", { label: "undo to restore everything" });
  check("Undo restores every document", true);

  // ------------------------------------------------------------- collections
  section("Collections");
  await page.eval(`
    await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage['dsms.token'] },
      body: JSON.stringify({ name: 'Quarterly Review' }),
    });
    return 'created';
  `);
  await openLibrary();
  check("a new collection appears in the sidebar", await page.eval("/quarterly review/i.test(document.querySelector('aside').innerText)"));

  // Record which documents were selected, rather than assuming the first three
  // checkboxes and the first card refer to the same documents.
  const chosen = await page.eval(`
    const boxes = [...document.querySelectorAll('input[type=checkbox][aria-label^="Select "]')].slice(0, 3);
    const ids = boxes.map((box) => box.closest('[data-doc-id]')?.getAttribute('data-doc-id'));
    boxes.forEach((box) => box.click());
    return ids.join(',');
  `);
  const chosenIds = chosen.split(",").filter(Boolean);
  const picked = chosenIds.length;
  check("three documents can be selected", picked === 3, chosen);

  // Wait for the selection to reach the sidebar rather than sleeping and hoping.
  // Without this the drop below can fire before React has propagated it, which
  // is a race that only shows up on a slower machine.
  let dropScope;
  try {
    // Note the exact comparison: "0" is a truthy string, so polling the raw
    // attribute would succeed immediately with no selection at all.
    dropScope = await page.waitFor(
      `document.querySelector('[data-drop-scope]')?.dataset.dropScope === '${picked}' ? '${picked}' : false`,
      { label: "the selection to reach the sidebar" }
    );
  } catch {
    dropScope = await page.eval("document.querySelector('[data-drop-scope]')?.dataset.dropScope ?? 'absent'");
  }
  check("the sidebar can see the selection", dropScope === String(picked), `data-drop-scope="${dropScope}"`);

  // The regression this pins: the sidebar could not see the library's selection,
  // so dragging a highlighted group filed exactly one document.
  //
  // The dragged card is addressed by id, not by position. Dragging whichever card
  // happens to be first only tests this if that card is one of the selected ones,
  // and a failure would look like a product bug rather than a bad test.
  const dragged = chosenIds[0];
  const dropDiagnostics = await page.eval(`
    const card = document.querySelector('[data-doc-id="${dragged}"]');
    const target = [...document.querySelectorAll('aside a, aside button, aside li')]
      .find((el) => /quarterly review/i.test(el.innerText || ''));
    if (!card) return 'NO_CARD';
    if (!target) return 'NO_TARGET';
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    // What the card actually put on the drag, and what the sidebar can see.
    const payload = transfer.getData('application/x-dsms-documents') || '(empty)';
    const scope = document.querySelector('[data-drop-scope]')?.dataset.dropScope ?? 'absent';
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    return 'payload=' + payload + ' scope=' + scope;
  `);
  const filed = await page.waitFor(
    `
      const list = await fetch('/api/collections', { headers: { Authorization: 'Bearer ' + localStorage['dsms.token'] } }).then(r => r.json());
      const target = list.collections.find((c) => /quarterly review/i.test(c.name));
      const count = target.documentCount ?? target.count;
      return count ? count + '/' + list.unfiled : false;
    `,
    { label: "the drop to be filed" }
  );
  check(
    "dragging one card of a three-document selection files all three",
    filed.startsWith("3/"),
    `filed/unfiled = ${filed} · dragged ${dragged} · ${dropDiagnostics}`
  );
  await shot("07-collections");

  // --------------------------------------------------------------- deep links
  section("A document has a shareable address");
  await openLibrary();
  const documentId = await page.eval("document.querySelector('[data-doc-id]').getAttribute('data-doc-id')");
  const expectedTitle = await page.eval(
    `document.querySelector('[data-doc-id="${documentId}"] .doc-card__title').innerText.trim()`
  );
  await page.goto(`${base}/documents/${documentId}`);
  let opened = true;
  try {
    // The drawer specifically: the library has its own tablist for grid/list.
    await page.waitFor("Boolean(document.querySelector('.drawer__body'))", { label: "the drawer from a deep link" });
  } catch {
    opened = false;
  }
  check("/documents/:id opens that document", opened, await page.eval("location.pathname"));

  // Assert on the drawer's own heading, not on page text: the library behind the
  // drawer also contains the title, so searching the whole body would pass even
  // if the wrong document opened. The drawer renders before its detail request
  // resolves, so this waits rather than reading a spinner.
  let opened_title = "";
  try {
    opened_title = await page.waitFor("document.querySelector('.drawer__header h2')?.innerText.trim() || false", {
      label: "the drawer to name the linked document",
    });
  } catch {
    opened_title = "(never rendered)";
  }
  check("and it is the document the link names", opened_title === expectedTitle, `drawer heading: ${opened_title}`);
  await shot("08-deep-link");
  await page.press("Escape");
  await page.waitFor("location.pathname === '/documents'", { label: "the address bar to return to the library" });
  check("closing it returns the address bar to the library", true);

  // -------------------------------------------------------------- discussion
  section("Discussion");
  // A fresh load: while a selection is active a click toggles selection rather
  // than opening the document, which is the behaviour we want but not the state
  // this section is testing.
  await openLibrary();
  await page.click(`[data-doc-id="${documentId}"]`);
  await page.waitFor("Boolean(document.querySelector('.drawer__body'))", { label: "the document drawer" });
  await page.waitFor("[...document.querySelectorAll('[role=tab]')].some(t => /discussion/i.test(t.innerText))", {
    label: "the Discussion tab",
  });
  await page.clickText("[role=tab]", "discussion");
  await page.waitFor("document.querySelectorAll('textarea').length > 0", { label: "the comment box" });
  check("the Discussion tab offers a comment box", true);
  await page.fill("textarea", "Checked in a real browser — @rio please confirm.");
  await page.clickText("button", "comment");
  await page.waitFor("/please confirm/i.test(document.body.innerText)", { label: "the comment to render" });
  check("a comment posts and renders", true);
  check("the @mention is marked up, not left as plain text", await page.eval("Boolean(document.querySelector('[class*=mention]'))"));
  await shot("09-discussion");
  await page.press("Escape");

  // -------------------------------------------------------- live over the wire
  section("Live notifications over Server-Sent Events");
  await openLibrary();
  const badgeBefore = await page.eval("document.querySelector('.notif-badge')?.innerText || 'none'");
  const navigationsBefore = await page.eval("performance.getEntriesByType('navigation').length");
  const triggered = await page.eval(`
    const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rio@dsms.dev', password: 'Member@12345' }) }).then(r => r.json());
    const shared = await fetch('/api/documents?scope=shared', { headers: { Authorization: 'Bearer ' + login.token } }).then(r => r.json());
    if (!shared.documents?.length) return 'NO_SHARED_DOCUMENT';
    const res = await fetch('/api/documents/' + shared.documents[0].id + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
      body: JSON.stringify({ body: 'pushed at ' + Date.now() + ' @admin@dsms.dev' }),
    });
    return 'HTTP ' + res.status;
  `);
  check("the other account can comment on a document shared with it", triggered === "HTTP 201", triggered);

  let badgeAfter = badgeBefore;
  try {
    badgeAfter = await page.waitFor(
      `
        const badge = document.querySelector('.notif-badge')?.innerText || 'none';
        return badge === ${JSON.stringify(badgeBefore)} ? false : badge;
      `,
      { timeout: 20000, label: "the unread badge to change" }
    );
  } catch {
    badgeAfter = badgeBefore;
  }
  check("the unread badge updates on its own", badgeAfter !== badgeBefore, `"${badgeBefore}" -> "${badgeAfter}"`);
  check(
    "with no page load in between, so it was pushed rather than polled",
    (await page.eval("performance.getEntriesByType('navigation').length")) === navigationsBefore
  );
  await page.eval("document.querySelector('.notif-button button, button[aria-label*=Notification]')?.click()");
  await page.waitFor("/mentioned you|commented/i.test(document.body.innerText)", { label: "the notification list" });
  check("the notification says who did what", true);
  await shot("10-notifications");

  // ------------------------------------------------------------ content search
  section("Search inside files");
  await openLibrary();
  await page.fill("main input[type=search]", "truthy");
  await page.waitFor("document.querySelectorAll('article.doc-card').length === 0", {
    label: "the metadata search to come back empty",
  });
  check("a word that only appears inside a file is not found by metadata search", true);
  await page.eval(`
    const label = [...document.querySelectorAll('label')].find((l) => /search contents/i.test(l.innerText));
    if (!label) return 'NO_TOGGLE';
    label.querySelector('input[type=checkbox]').click();
    return 'toggled';
  `);
  await page.waitFor("document.querySelectorAll('article.doc-card').length === 1", { label: "the content search result" });
  check("enabling 'Search contents' finds it", true);
  check(
    "and the match is highlighted inside an excerpt",
    (await page.eval("document.querySelector('mark.snippet-hit')?.innerText.toLowerCase()")) === "truthy",
    await page.eval("(document.querySelector('.doc-card__snippet')?.innerText || '-').slice(0,90)")
  );
  await shot("11-content-search");

  // -------------------------------------------- accessibility, motion, offline
  section("Accessibility, motion and the offline shell");
  check("there is a skip link for keyboard users", await page.eval("Boolean([...document.querySelectorAll('a')].find(a => /skip/i.test(a.innerText)))"));
  await page.setReducedMotion(true);
  await openLibrary();
  check(
    "with reduced motion every document still renders",
    (await page.eval("document.querySelectorAll('article.doc-card').length")) === 5
  );
  check(
    "and entry animations are collapsed rather than merely shortened",
    await page.eval("parseFloat(getComputedStyle(document.querySelector('article.doc-card')).animationDuration) < 0.05"),
    await page.eval("getComputedStyle(document.querySelector('article.doc-card')).animationDuration")
  );
  await shot("12-reduced-motion");
  await page.setReducedMotion(false);

  check("the manifest is linked, so the app can be installed", await page.eval("Boolean(document.querySelector('link[rel=manifest]'))"));
  const worker = await page.eval(`
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.length + '|' + Boolean(navigator.serviceWorker.controller);
  `);
  check("the service worker registers and takes control", worker.startsWith("1|"), worker);
  const cached = await page.eval(`
    let shell = 0;
    let api = 0;
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      shell += keys.length;
      api += keys.filter((request) => new URL(request.url).pathname.startsWith('/api/')).length;
    }
    return shell + '|' + api;
  `);
  check(
    "and it never caches an /api response",
    cached.endsWith("|0"),
    `${cached.split("|")[0]} shell entries, ${cached.split("|")[1]} api entries`
  );

  // ----------------------------------------------------------------- responsive
  section("Responsive layout");
  await page.setViewport(390, 844);
  await openLibrary();
  check("the library renders on a phone viewport", (await page.eval("document.querySelectorAll('article.doc-card').length")) === 5);
  check(
    "with no horizontal overflow",
    await page.eval("document.documentElement.scrollWidth <= window.innerWidth + 2"),
    await page.eval("document.documentElement.scrollWidth + 'px of content in ' + window.innerWidth + 'px'")
  );
  await shot("13-mobile");
  await page.setViewport(1440, 900);

  // ---------------------------------------------------------------- the member
  section("The same instance, seen by a member");
  await page.eval("localStorage.clear()");
  await signIn("rio@dsms.dev", "Member@12345");
  const memberCount = await page.eval("document.querySelectorAll('article.doc-card').length");
  check("a member sees only what they own or were shared", memberCount > 0 && memberCount < 5, `${memberCount} documents`);
  check("the admin section is not offered to them", await page.eval("!/instance health/i.test(document.querySelector('aside').innerText)"));
  check(
    "and the admin API refuses them too",
    await page.eval(`
      const res = await fetch('/api/admin/users', { headers: { Authorization: 'Bearer ' + localStorage['dsms.token'] } });
      return res.status === 403;
    `)
  );
  await shot("14-member-view");
}
