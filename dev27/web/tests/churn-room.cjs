// Run with NODE_PATH pointing to an external Playwright installation.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("node:module").createRequire(require.resolve("playwright"))("typescript");
const fixtureModule = { exports: {} };
const fixturePath = path.resolve(__dirname, "../../lib/demo-fixtures.ts");
const compiled = ts.transpileModule(fs.readFileSync(fixturePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("exports", "require", "module", compiled)(
  fixtureModule.exports,
  require,
  fixtureModule,
);
const { emptyRoom, churnedFixture, metricsFixture, comparisonFixture } = fixtureModule.exports;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = process.env.FRONTEND_URL || "http://127.0.0.1:3000";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const contexts = [];
  let state = structuredClone(emptyRoom);
  let failNext = false;
  let missingMetric = false;
  let delayedPoll = false;
  let failGets = false;
  let failParticipantSave = false;
  const requests = [];
  const completedIds = new Set();
  const registry = [
    { name: "Priya", team: "Finance", author: "Priya" },
    { name: "Alex", team: "Product", author: "Alex" },
    { name: "Sam", team: "Sales", author: "Sam" },
  ];
  const timestamp = "2026-07-01T10:00:00Z";
  async function createPage(name, width = 1440) {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width, height: 1000 },
    });
    contexts.push(context);
    await context.route("**/api/rooms/**", async (route) => {
      const request = route.request();
      if (request.url().endsWith("/participants")) {
        if (request.method() === "GET") return route.fulfill({ status: 200, json: registry });
        if (failParticipantSave) {
          failParticipantSave = false;
          return route.fulfill({ status: 503, json: { error: "unavailable" } });
        }
        const input = request.postDataJSON();
        let person = registry.find(
          (value) =>
            value.name.toLowerCase() === input.name.trim().toLowerCase() &&
            value.team.toLowerCase() === input.team.trim().toLowerCase(),
        );
        if (!person) {
          person = {
            name: input.name.trim(),
            team: input.team.trim(),
            author: `${input.name.trim()} / ${input.team.trim()}`,
          };
          registry.push(person);
        }
        return route.fulfill({ status: 200, json: person });
      }
      if (request.url().endsWith(".csv")) {
        const id = request.url().split("/").at(-1).replace(".csv", "");
        const result = state.results.find((r) => r.id === id);
        return route.fulfill({
          status: 200,
          contentType: "text/csv",
          headers: { "Content-Disposition": `attachment; filename="${id}.csv"` },
          body: [
            result.columns.map((c) => c.key).join(","),
            ...result.rows.map((row) => result.columns.map((c) => row[c.key] ?? "").join(",")),
          ].join("\n"),
        });
      }
      if (request.method() === "GET") {
        if (failGets) return route.abort("failed");
        const snapshot = JSON.stringify(state);
        if (delayedPoll) {
          delayedPoll = false;
          await delay(1200);
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: snapshot });
      }
      const input = request.postDataJSON();
      requests.push(input);
      if (failNext) {
        failNext = false;
        await delay(300);
        return route.abort("failed");
      }
      if (completedIds.has(input.clientMessageId))
        return route.fulfill({ status: 200, json: state });
      if (state.busy) return route.fulfill({ status: 409, json: { error: "room_busy" } });
      state.busy = true;
      state.revision++;
      await delay(500);
      const question = input.text;
      let result;
      let reply;
      if (question === "Which customers churned?")
        reply = "Which reporting period should I use? This demo supports Q2 2026.";
      else if (question === "Q2 2026") {
        result = churnedFixture;
        reply = "Four customers churned, representing $8,000 in lost monthly subscription revenue.";
      } else if (question.includes("before they churned")) {
        result = structuredClone(metricsFixture);
        if (missingMetric) result.rows[0].weekly_active_users = null;
        reply = "Here are their January–March metrics.";
      } else if (question.includes("Compare")) {
        result = comparisonFixture;
        reply = "SMB: 42.9%. Enterprise: 7.7%.";
      } else reply = "This demo supports three actions.";
      state.messages.push({
        id: `user-${state.revision}`,
        role: "user",
        author: input.author,
        text: question,
        createdAt: timestamp,
        resultId: null,
      });
      state.messages.push({
        id: `agent-${state.revision}`,
        role: "assistant",
        author: "Q-Agent",
        text: reply,
        createdAt: timestamp,
        resultId: result?.id ?? null,
      });
      if (result) {
        state.results = [...state.results.filter((r) => r.id !== result.id), result];
        state.customerIds = ["C001", "C002", "C003", "C008"];
        state.period = "Q2 2026";
      }
      state.history.push({
        id: `history-${state.revision}`,
        author: input.author,
        question,
        clarifications: question === "Q2 2026" ? [{ author: input.author, text: "Q2 2026" }] : [],
        createdAt: timestamp,
        status: result ? "completed" : "awaiting_period",
        filters: { period: "Q2 2026" },
        queryId: result?.kind ?? null,
        sql: result ? "SELECT * FROM synthetic_data WHERE period = :period" : null,
        parameters: { period: "Q2 2026" },
        rowCount: result?.rows.length ?? null,
        resultId: result?.id ?? null,
      });
      state.busy = false;
      state.revision++;
      completedIds.add(input.clientMessageId);
      return route.fulfill({ status: 200, json: state });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    assert.equal(await page.getByLabel("Message Q-Agent").count(), 0);
    assert.equal(await page.getByRole("button", { name: /^History/ }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByLabel("Your name", { exact: true }).selectOption(name);
    await page.getByRole("button", { name: "Start demo" }).click();
    await page.getByText("Shared room live", { exact: true }).waitFor();
    return page;
  }
  async function send(page, text) {
    await page.getByLabel("Message Q-Agent").fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("textarea").value === "");
  }
  try {
    const finance = await createPage("Priya");
    const product = await createPage("Alex");
    assert.equal(await finance.getByRole("link", { name: "CSV", exact: true }).count(), 0);
    assert.equal(await finance.locator(".result-query").count(), 0);
    await send(finance, "Which customers churned?");
    await product.getByText("Which reporting period should I use?", { exact: false }).waitFor();
    assert.equal(await finance.getByRole("link", { name: "CSV", exact: true }).count(), 0);
    await send(finance, "Q2 2026");
    await product.getByRole("heading", { name: churnedFixture.title }).waitFor();
    assert.equal(await finance.locator("tbody tr").count(), 4);
    assert.equal(await product.locator("tbody tr").count(), 4);
    await finance.screenshot({ path: "/tmp/opencode/churn-room-desktop.png", fullPage: true });
    await send(product, "How were those customers doing before they churned?");
    await finance.getByRole("heading", { name: metricsFixture.title }).waitFor();
    assert.equal(await product.locator("tbody tr").count(), 12);
    await product.getByRole("img", { name: /Willow Fashion: weekly active users/ }).waitFor();
    await product.getByRole("combobox", { name: /^Metric/ }).selectOption("resolution_hours");
    await product.getByRole("img", { name: /resolution hours in hours/ }).waitFor();
    await send(finance, "Compare them with customers who stayed.");
    await product.getByRole("heading", { name: comparisonFixture.title }).waitFor();
    assert.equal(await product.locator("tbody tr").count(), 2);
    assert.ok((await product.locator(".result-query").innerText()).includes("comparison / 2 rows"));
    await product.locator(".source-table > summary").click();
    assert.ok((await product.locator("tbody").innerText()).includes("42.9%"));
    await product.reload();
    await product.getByRole("heading", { name: comparisonFixture.title }).waitFor();
    assert.equal(await product.locator(".current-participant").innerText(), "Alex / Product");
    await finance.getByRole("button", { name: /^History/ }).click();
    await finance.getByRole("button", { name: "View stored result" }).last().click();
    await finance.getByRole("heading", { name: churnedFixture.title }).waitFor();
    assert.ok((await finance.locator(".result-query").innerText()).includes("churned / 4 rows"));
    assert.equal(
      await finance.getByRole("link", { name: "CSV", exact: true }).getAttribute("href"),
      churnedFixture.downloadUrl,
    );
    await product.getByRole("heading", { name: comparisonFixture.title }).waitFor();
    const csv = await finance
      .getByRole("link", { name: "CSV", exact: true })
      .evaluate(async (link) => (await fetch(link.href)).text());
    assert.equal(csv.split("\n").length, 5);
    assert.ok(csv.includes("C001,Willow Fashion"));
    await finance.getByText("Filters, SQL & parameters").nth(2).click();
    await finance
      .locator(".history-panel")
      .getByText("SELECT * FROM synthetic_data WHERE period = :period", { exact: true })
      .nth(2)
      .waitFor();

    // Race sends before the next poll exposes busy state.
    await finance.getByLabel("Message Q-Agent").fill("Concurrent Finance request");
    await product.getByLabel("Message Q-Agent").fill("Concurrent Product request");
    await Promise.all([
      finance.getByRole("button", { name: "Send message", exact: true }).click(),
      product.getByRole("button", { name: "Send message", exact: true }).click(),
    ]);
    await delay(800);
    const loser = (await product.getByLabel("Message Q-Agent").inputValue()) ? product : finance;
    const loserText = await loser.getByLabel("Message Q-Agent").inputValue();
    assert.ok(loserText.startsWith("Concurrent"));
    await loser.locator(".send-error").waitFor();
    const firstAttempt = requests.find((r) => r.text === loserText);
    await loser.getByRole("button", { name: "Retry message" }).click();
    await loser.waitForFunction(() => document.querySelector("textarea").value === "");
    const attempts = requests.filter((r) => r.text === loserText);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].clientMessageId, firstAttempt.clientMessageId);

    failNext = true;
    await finance.getByLabel("Message Q-Agent").fill("Network retry");
    await finance.getByRole("button", { name: "Send message", exact: true }).click();
    await finance.locator(".send-error").waitFor();
    assert.equal(await finance.getByLabel("Message Q-Agent").inputValue(), "Network retry");
    await finance.getByRole("button", { name: "Retry message" }).click();
    await finance.waitForFunction(() => document.querySelector("textarea").value === "");
    const retryIds = requests
      .filter((r) => r.text === "Network retry")
      .map((r) => r.clientMessageId);
    assert.equal(retryIds[0], retryIds[1]);

    failNext = true;
    await finance.getByLabel("Message Q-Agent").fill("Failed original text");
    await finance.getByRole("button", { name: "Send message", exact: true }).click();
    await finance.getByLabel("Message Q-Agent").fill("Edited next draft");
    await finance.getByRole("button", { name: "Retry original message" }).click();
    await delay(800);
    assert.equal(await finance.getByLabel("Message Q-Agent").inputValue(), "Edited next draft");
    const originalIds = requests
      .filter((r) => r.text === "Failed original text")
      .map((r) => r.clientMessageId);
    assert.equal(originalIds.length, 2);
    assert.equal(originalIds[0], originalIds[1]);

    await finance.getByLabel("Message Q-Agent").fill("Keep next draft");
    await finance.getByRole("button", { name: "Send message", exact: true }).click();
    await finance.getByLabel("Message Q-Agent").fill("My next question must survive");
    await delay(800);
    assert.equal(
      await finance.getByLabel("Message Q-Agent").inputValue(),
      "My next question must survive",
    );

    missingMetric = true;
    await send(product, "How were those customers doing before they churned?");
    await product.locator(".source-table > summary").click();
    assert.equal(
      await product.locator("tbody tr").first().locator("td").nth(3).innerText(),
      "\u2014",
    );
    const chartLabel = await product
      .getByRole("img", { name: /^Willow Fashion:/ })
      .getAttribute("aria-label");
    assert.ok(chartLabel.includes("2026-01: missing"));

    // A delayed old GET must not replace a newly completed POST.
    delayedPoll = true;
    await delay(100);
    await send(product, "Compare them with customers who stayed.");
    await delay(1800);
    await product.getByRole("heading", { name: comparisonFixture.title }).waitFor();

    const mobile = await createPage("Sam", 390);
    await mobile.getByRole("heading", { name: comparisonFixture.title }).waitFor();
    assert.ok(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    );
    await mobile.screenshot({ path: "/tmp/opencode/churn-room-mobile.png", fullPage: true });
    failGets = true;
    await mobile.getByText("Reconnecting", { exact: true }).waitFor();
    await mobile.getByRole("heading", { name: comparisonFixture.title }).waitFor();
    assert.equal(await mobile.locator("tbody tr").count(), 2);
    failGets = false;
    await mobile.getByText("Shared room live", { exact: true }).waitFor();
    await mobile.getByText("About demo data", { exact: true }).click();
    await mobile
      .getByText("All teams query the same synthetic dataset:", { exact: false })
      .waitFor();
    await mobile.getByRole("button", { name: "Change participant" }).click();
    assert.equal(await mobile.getByLabel("Message Q-Agent").count(), 0);
    await mobile.getByLabel("Your name", { exact: true }).selectOption("__new__");
    await mobile.getByLabel("New name", { exact: true }).fill("Div");
    await mobile.getByLabel("Your team", { exact: true }).selectOption("__new__");
    await mobile.getByLabel("New team", { exact: true }).fill("Marketing");
    failParticipantSave = true;
    await mobile.getByRole("button", { name: "Start demo", exact: true }).click();
    await mobile.getByText("Your participant could not be saved.", { exact: false }).waitFor();
    assert.equal(await mobile.getByLabel("New name", { exact: true }).inputValue(), "Div");
    assert.equal(await mobile.getByLabel("New team", { exact: true }).inputValue(), "Marketing");
    assert.equal(await mobile.locator(".current-participant").count(), 0);
    assert.equal(registry.length, 3);
    await mobile.getByRole("button", { name: "Start demo", exact: true }).click();
    assert.equal(await mobile.locator(".current-participant").innerText(), "Div / Marketing");
    const savedParticipantBrowser = await createPage("Div");
    assert.equal(
      await savedParticipantBrowser.locator(".current-participant").innerText(),
      "Div / Marketing",
    );
    assert.equal(registry.filter((person) => person.name === "Div").length, 1);
    await send(mobile, "Compare them with customers who stayed.");
    await finance
      .locator(".message-heading strong")
      .filter({ hasText: "Div / Marketing" })
      .waitFor();
    await mobile.reload();
    await mobile.getByText("Shared room live", { exact: true }).waitFor();
    assert.equal(await mobile.locator(".current-participant").innerText(), "Div / Marketing");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: two independent browsers, shared results, refresh, 4/12/2 rows, chart selectors, original CSV, history, simultaneous sends, network retry UUID, in-flight draft edits, missing metrics, revision guard, mobile layout, no page errors.",
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
