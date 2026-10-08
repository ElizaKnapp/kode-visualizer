// The demo on the home page: a small, made-up Cursor window with the PR Map panel at the bottom. It
// works like the real panel: click a flow tab, a box or a file, and the file opens in the editor while
// "This file" says what the PR changes there. A guided tour clicks through it once, then hands over.
// All the code in it is invented for the demo.

// ---------- the made-up PR

// Each line starts with "+" (added), "-" (removed) or " " (unchanged).
const FILES = {
  "app/controllers/api/v1/signups_controller.rb": {
    status: "unchanged",
    code: `
 class Api::V1::SignupsController < ApiController
   def create
     user = SignupActivity.new.call(signup_params)
     render json: UserSerializer.new(user), status: :created
   end
 end`,
  },
  "app/activities/signup_activity.rb": {
    status: "modified",
    code: `
 class SignupActivity
   def call(params)
     user = User.new(params)
     ActiveRecord::Base.transaction do
       user.save!
-      WelcomeMailer.deliver(user)
     end
+    WelcomeEmailJob.perform_later(user.id)
     user
   end
 end`,
  },
  "app/jobs/welcome_email_job.rb": {
    status: "added",
    code: `
+class WelcomeEmailJob < ApplicationJob
+  retry_on EmailProvider::Timeout, attempts: 3
+
+  def perform(user_id)
+    user = User.find(user_id)
+    return if EmailSuppression.blocked?(user.email)
+
+    EmailProvider.send_template(:welcome, to: user.email)
+    user.touch(:welcome_sent_at)
+  end
+end`,
  },
  "app/controllers/webhooks/email_bounces_controller.rb": {
    status: "added",
    code: `
+class Webhooks::EmailBouncesController < WebhooksController
+  before_action :verify_signature!
+
+  def create
+    params[:events].each do |event|
+      next unless event[:type] == "hard_bounce"
+      EmailSuppression.find_or_create_by!(email: event[:email].downcase)
+    end
+    head :ok
+  end
+end`,
  },
  "app/models/email_suppression.rb": {
    status: "added",
    code: `
+class EmailSuppression < ApplicationRecord
+  validates :email, presence: true, uniqueness: true
+
+  def self.blocked?(email)
+    exists?(email: email.downcase)
+  end
+end`,
  },
  "config/schedule.yml": {
    status: "modified",
    code: `
 cleanup_sessions:
   cron: "0 3 * * *"
   class: CleanupSessionsJob
+retry_welcome_emails:
+  cron: "0 2 * * *"
+  class: RetryWelcomeEmailsJob`,
  },
  "app/jobs/retry_welcome_emails_job.rb": {
    status: "added",
    code: `
+class RetryWelcomeEmailsJob < ApplicationJob
+  def perform
+    User.where(welcome_sent_at: nil)
+        .where(created_at: 1.week.ago..1.hour.ago)
+        .find_each { |user| WelcomeEmailJob.perform_later(user.id) }
+  end
+end`,
  },
  "app/mailers/welcome_mailer.rb": {
    status: "removed",
    does: "Sent the welcome email inside the signup save. Deleted: WelcomeEmailJob does this now.",
    code: `
-class WelcomeMailer < ApplicationMailer
-  def self.deliver(user)
-    EmailProvider.send_template(:welcome, to: user.email)
-  end
-end`,
  },
  "db/migrate/20261007_create_email_suppressions.rb": {
    status: "added",
    does: "Makes the email_suppressions table, with a unique index on email.",
    code: `
+class CreateEmailSuppressions < ActiveRecord::Migration[7.1]
+  def change
+    create_table :email_suppressions do |t|
+      t.string :email, null: false
+      t.timestamps
+    end
+    add_index :email_suppressions, :email, unique: true
+  end
+end`,
  },
};

const ROUTE = "app/controllers/api/v1/signups_controller.rb";
const ACTIVITY = "app/activities/signup_activity.rb";
const JOB = "app/jobs/welcome_email_job.rb";
const BOUNCES = "app/controllers/webhooks/email_bounces_controller.rb";
const SUPPRESSION = "app/models/email_suppression.rb";
const SCHEDULE = "config/schedule.yml";
const RETRY = "app/jobs/retry_welcome_emails_job.rb";
const MAILER = "app/mailers/welcome_mailer.rb";

// A box with a file opens it. A box with a number is that file in the reading order.
const FLOWS = [
  {
    id: "signup",
    title: "Signup → welcome email",
    trigger: { kind: "API call", name: "POST /api/v1/signup", file: ROUTE },
    summary: "A user signs up. The activity saves the user, then queues the welcome job outside the save. The job sends the email through the provider.",
    files: [
      { node: "activity", path: ACTIVITY, changed: "Queues the welcome job after the save, not inside it. A failed send no longer rolls back the signup." },
      { node: "job", path: JOB, changed: "New. Sends the welcome email, and tries again up to 3 times if the provider times out." },
    ],
    boxes: [
      { id: "route", label: "POST /api/v1/signup", sub: "SignupsController", file: ROUTE, x: 20, y: 40, w: 180 },
      { id: "activity", label: "SignupActivity", sub: "activities", file: ACTIVITY, x: 250, y: 40, w: 170 },
      { id: "job", label: "WelcomeEmailJob", sub: "jobs", file: JOB, x: 470, y: 40, w: 150 },
      { id: "mailer", label: "WelcomeMailer", sub: "mailers", file: MAILER, x: 250, y: 170, w: 170 },
      { id: "provider", label: "Email provider", sub: "outside service", x: 470, y: 170, w: 150 },
    ],
    edges: [["route", "activity"], ["activity", "job"], ["job", "provider"], ["activity", "mailer", "removed"]],
  },
  {
    id: "bounce",
    title: "Bounce webhook → suppress",
    trigger: { kind: "Webhook", name: "POST /webhooks/email/bounce", file: BOUNCES },
    summary: "The provider tells us an email bounced. The new controller adds the address to a suppression list. The welcome job checks that list before it sends.",
    files: [
      { node: "bounces", path: BOUNCES, changed: "New. Checks the provider's signature, then saves every hard-bounced address in lowercase." },
      { node: "suppression", path: SUPPRESSION, changed: "New. The list of addresses we stop emailing. Looks them up in lowercase, so the case of the address doesn't matter." },
      { node: "job", path: JOB, changed: "Skips the send if the address is on the suppression list. This is the only place the list gets read." },
    ],
    boxes: [
      { id: "provider", label: "Email provider", sub: "sends the webhook", x: 20, y: 40, w: 160 },
      { id: "bounces", label: "EmailBouncesController", sub: "webhooks", file: BOUNCES, x: 230, y: 40, w: 200 },
      { id: "suppression", label: "EmailSuppression", sub: "models", file: SUPPRESSION, x: 470, y: 40, w: 150 },
      { id: "job", label: "WelcomeEmailJob", sub: "jobs", file: JOB, x: 470, y: 170, w: 150 },
    ],
    edges: [["provider", "bounces"], ["bounces", "suppression"], ["job", "suppression"]],
  },
  {
    id: "nightly",
    title: "Nightly retry job",
    trigger: { kind: "Schedule", name: "retry_welcome_emails · 0 2 * * *", file: SCHEDULE },
    summary: "Every night at 2am, a job finds users from the last week who never got the welcome email, and queues the send again.",
    files: [
      { node: "schedule", path: SCHEDULE, changed: "Adds the nightly entry that runs the retry job at 2am." },
      { node: "retry", path: RETRY, changed: "New. Finds users from the past week with no welcome email and queues the job for each one." },
    ],
    boxes: [
      { id: "schedule", label: "Nightly at 2am", sub: "config/schedule.yml", file: SCHEDULE, x: 20, y: 40, w: 170 },
      { id: "retry", label: "RetryWelcomeEmailsJob", sub: "jobs", file: RETRY, x: 230, y: 40, w: 200 },
      { id: "job", label: "WelcomeEmailJob", sub: "jobs", file: JOB, x: 470, y: 40, w: 150 },
      { id: "provider", label: "Email provider", sub: "outside service", x: 470, y: 170, w: 150 },
    ],
    edges: [["schedule", "retry"], ["retry", "job"], ["job", "provider"]],
  },
];

const PR_TITLE = "Send welcome emails from a background job";
const BOX_HEIGHT = 52;
const STATUS_LETTER = { added: "A", modified: "M", removed: "D" };
const flowById = (id) => FLOWS.find((f) => f.id === id);
const fileName = (path) => path.split("/").pop();
const flowsWith = (path) => FLOWS.filter((f) => f.files.some((file) => file.path === path));
const notInAFlow = Object.keys(FILES).filter((path) => FILES[path].status !== "unchanged" && !flowsWith(path).length);

// ---------- state

const fresh = () => ({ flow: "signup", open: [], active: null });
let state = fresh();

function switchFlow(id) {
  state.flow = id;
  render();
}

function openFile(path) {
  if (!state.open.includes(path)) state.open.push(path);
  state.active = path;
  render();
  showFirstChange();
}

// ---------- building elements

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  return fill(el, attrs, children);
};
const s = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  return fill(el, attrs, children);
};
function fill(el, attrs, children) {
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const badge = (n) => h("span", { class: "badge" }, n);

// Lights up a box and its row in the file list together.
function light(node, on) {
  ide.querySelectorAll(`[data-node="${node}"]`).forEach((el) => el.classList.toggle("on", on));
}
const hover = (node) => ({ onmouseenter: () => light(node, true), onmouseleave: () => light(node, false) });

// ---------- sidebar

function sidebar() {
  const row = (path, number) =>
    h("button", { class: `tree-file${path === state.active ? " active" : ""}`, "data-path": path, onclick: () => openFile(path) },
      h("span", { class: "tree-name" }, number ? `${number}. ` : "", fileName(path)),
      h("span", { class: "tree-dir" }, path.slice(0, -fileName(path).length - 1)),
      h("span", { class: `git ${FILES[path].status}` }, STATUS_LETTER[FILES[path].status]));
  const group = (label, rows) =>
    h("div", { class: "tree-group" }, h("div", { class: "tree-label" }, "▾ ", label, h("span", { class: "count" }, rows.length)), rows);
  return h("div", { class: "sidebar" },
    h("div", { class: "pane-title" }, "PR Map: Files"),
    FLOWS.map((f) => group(f.title, f.files.map((file, i) => row(file.path, i + 1)))),
    group("Not in a flow", notInAFlow.map((path) => row(path))));
}

// ---------- editor

const TOKENS = /(#.*$)|("[^"]*")|\b(class|def|end|do|if|unless|next|return|self)\b|(:[a-z_!?]+)|\b([A-Z]\w*)\b|\b(\d+)\b/g;
const TOKEN_CLASS = ["comment", "string", "keyword", "symbol", "constant", "number"];

// Colours one line of Ruby or YAML, well enough for a demo.
function highlight(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    out.push(text.slice(last, m.index));
    const kind = TOKEN_CLASS[m.slice(1).findIndex((group) => group !== undefined)];
    out.push(h("span", { class: `tok-${kind}` }, m[0]));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function editor() {
  if (!state.active) {
    return h("div", { class: "editor" }, h("div", { class: "editor-empty" }, "Click a box or a file below and it opens here."));
  }
  let number = 0;
  const lines = FILES[state.active].code.slice(1).split("\n").map((raw) => {
    const mark = raw[0];
    if (mark !== "-") number += 1;
    const kind = mark === "+" ? "added" : mark === "-" ? "removed" : "";
    return h("div", { class: `line ${kind}` }, h("span", { class: "ln" }, mark === "-" ? "" : number), h("span", { class: "src" }, highlight(raw.slice(1))));
  });
  return h("div", { class: "editor" },
    h("div", { class: "editor-tabs" },
      state.open.map((path) =>
        h("button", { class: `editor-tab${path === state.active ? " active" : ""}`, onclick: () => openFile(path) }, fileName(path)))),
    h("div", { class: "crumbs" }, state.active.split("/").join(" › ")),
    h("div", { class: "code" }, lines));
}

// Scrolls the editor to the first line this PR changed and flashes the changes, like opening at a line.
function showFirstChange() {
  const code = ide.querySelector(".code");
  const first = code?.querySelector(".added, .removed");
  if (!first) return;
  code.scrollTop = Math.max(0, first.offsetTop - code.offsetTop - 38);
  code.querySelectorAll(".added, .removed").forEach((line) => line.classList.add("flash"));
}

// ---------- PR Map panel

function edgePath(a, b) {
  // To the right: leave from the right side. Otherwise go straight down or up between the boxes.
  if (b.x >= a.x + a.w) {
    const x1 = a.x + a.w, y1 = a.y + BOX_HEIGHT / 2, x2 = b.x - 3, y2 = b.y + BOX_HEIGHT / 2, mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }
  const down = b.y > a.y;
  const x1 = a.x + a.w / 2, y1 = down ? a.y + BOX_HEIGHT : a.y;
  const x2 = b.x + b.w / 2, y2 = down ? b.y - 3 : b.y + BOX_HEIGHT + 3, my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

const arrow = (id, color) =>
  s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" }, s("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));

function diagram(flow) {
  const byId = Object.fromEntries(flow.boxes.map((b) => [b.id, b]));
  const numbers = Object.fromEntries(flow.files.map((f, i) => [f.node, i + 1]));
  return s("svg", { class: "diagram", viewBox: "0 0 640 250", role: "img", "aria-label": `Diagram of the ${flow.title} flow` },
    s("defs", {}, arrow("arrow", "#8c959f"), arrow("arrow-removed", "#cf222e")),
    flow.edges.map(([from, to, kind]) =>
      s("path", { class: `edge ${kind ?? "flowing"}`, d: edgePath(byId[from], byId[to]), "marker-end": `url(#${kind === "removed" ? "arrow-removed" : "arrow"})` })),
    flow.boxes.map((b) => {
      const status = b.file ? FILES[b.file].status : "unchanged";
      const clickable = b.file && status !== "removed";
      return s("g", {
        class: `box ${status}${clickable ? " clickable" : ""}`,
        "data-node": b.id,
        tabindex: clickable ? 0 : null,
        role: clickable ? "button" : null,
        onclick: () => clickable && openFile(b.file),
        onkeydown: (e) => clickable && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openFile(b.file)),
        ...hover(b.id),
      },
      s("title", {}, `${b.label}\n${status === "removed" ? "Deleted in this PR" : clickable ? "Click to open" : "Not in this repo"}`),
      s("rect", { x: b.x, y: b.y, width: b.w, height: BOX_HEIGHT, rx: 9 }),
      s("text", { class: "name", x: b.x + 14, y: b.y + 23 }, b.label),
      s("text", { class: "sub", x: b.x + 14, y: b.y + 40 }, b.sub),
      numbers[b.id] && s("g", { class: "num" }, s("circle", { cx: b.x, cy: b.y, r: 10 }), s("text", { x: b.x, y: b.y + 4 }, numbers[b.id])));
    }));
}

// What this PR changes in the file open in the editor, for the flow on screen. Same rules as the panel.
function thisFile(flow) {
  const box = h("section", { class: "this-file" }, h("h3", {}, "This file"));
  if (!state.active) return fill(box, {}, [h("p", { class: "muted" }, "Open a file from the list above.")]);
  const index = flow.files.findIndex((f) => f.path === state.active);
  box.append(h("div", { class: "file-name" }, index >= 0 && badge(index + 1), h("code", {}, state.active)));
  const elsewhere = flowsWith(state.active);
  if (index >= 0) {
    box.append(h("p", {}, flow.files[index].changed));
  } else if (elsewhere.length) {
    box.append(h("p", { class: "muted" }, "This file isn't in this flow. It's in:"),
      h("ul", { class: "elsewhere" }, elsewhere.map((f) => h("li", {}, h("button", { class: "link", onclick: () => switchFlow(f.id) }, f.title)))));
  } else if (FILES[state.active].does) {
    box.append(h("p", {}, FILES[state.active].does), h("p", { class: "muted" }, "Not part of any flow."));
  } else {
    box.append(h("p", { class: "muted" }, "This PR doesn't change this file."));
  }
  return box;
}

function aside(flow) {
  return h("aside", { class: "flow-col" },
    h("div", { class: "flow-scroll" },
    h("section", { class: "trigger" },
      h("div", { class: "kicker" }, `Starts with: ${flow.trigger.kind}`),
      h("button", { class: "link trigger-name", onclick: () => openFile(flow.trigger.file) }, flow.trigger.name)),
    h("section", {}, h("h3", {}, "How it fits together"), h("p", {}, flow.summary)),
    h("section", {},
      h("h3", {}, "Files to review, in order"),
      h("ol", { class: "files" },
        flow.files.map((f, i) =>
          h("li", {},
            h("button", { class: `file${f.path === state.active ? " active" : ""}`, "data-node": f.node, onclick: () => openFile(f.path), ...hover(f.node) },
              badge(i + 1), h("span", {}, h("span", { class: "heading" }, fileName(f.path)), h("code", {}, f.path)))))))),
    thisFile(flow));
}

function panel() {
  const flow = flowById(state.flow);
  return h("div", { class: "panel" },
    h("div", { class: "panel-tabs" }, ["Problems", "Output", "Terminal"].map((t) => h("span", {}, t)), h("span", { class: "active" }, "PR Map")),
    h("div", { class: "toolbar" }, h("b", {}, PR_TITLE), h("span", { class: "fake-button" }, "Redraw")),
    h("div", { class: "flow-tabs", role: "tablist" },
      FLOWS.map((f) =>
        h("button", { class: `flow-tab${f.id === flow.id ? " active" : ""}`, role: "tab", "aria-selected": String(f.id === flow.id), "data-flow": f.id, onclick: () => switchFlow(f.id) }, f.title))),
    h("div", { class: "body-grid" }, h("div", { class: "diagram-card" }, diagram(flow)), aside(flow)));
}

// ---------- the window

const ide = document.getElementById("ide");
const pointer = document.getElementById("tour-pointer");

// Everything is drawn again on each click, so the lists keep where they were scrolled to.
const SCROLLERS = [".sidebar", ".code", ".flow-scroll"];

function render() {
  const scrolled = SCROLLERS.map((selector) => ide.querySelector(selector)?.scrollTop ?? 0);
  ide.querySelector(".ide-title span").textContent = `${state.active ? fileName(state.active) : "PR Map"} — signup-welcome-emails`;
  ide.querySelector(".ide-body").replaceChildren(sidebar(), editor(), panel());
  SCROLLERS.forEach((selector, i) => {
    const el = ide.querySelector(selector);
    if (el) el.scrollTop = scrolled[i];
  });
}

// ---------- guided tour

const q = (selector) => () => ide.querySelector(selector);
const TOUR = [
  { say: "Each flow in the PR gets its own tab. This one starts with a signup API call.", at: q('[data-flow="signup"]'), act: () => switchFlow("signup") },
  { say: "Hover a box and its file lights up in the list on the right.", at: q('.diagram [data-node="activity"]'), act: () => light("activity", true) },
  { say: "Click it. The file opens above, at the lines this PR changed. “This file” says what changed.", at: q('.diagram [data-node="activity"]'), act: () => openFile(ACTIVITY) },
  { say: "Read the files in order. File 2 is the new job.", at: q('.files [data-node="job"]'), act: () => openFile(JOB) },
  { say: "Switch flows. The same file is number 3 here, and its summary is about this flow now.", at: q('[data-flow="bounce"]'), act: () => switchFlow("bounce") },
  { say: "Open a file from another flow, and the panel tells you where it belongs.", at: q(`.sidebar [data-path="${RETRY}"]`), act: () => openFile(RETRY) },
  { say: "One click takes you there.", at: q(".elsewhere .link"), act: () => switchFlow("nightly") },
];

const caption = document.getElementById("tour-caption");
const replay = document.getElementById("tour-replay");
let run = 0;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Puts the fake pointer's tip on the middle of an element. Skips it if the element is hidden (the
// sidebar on a phone), and the step still happens.
function pointAt(el) {
  // The sidebar scrolls, so bring the row into its view first.
  const list = el?.closest(".sidebar");
  if (list) list.scrollTop = el.offsetTop - list.clientHeight / 2;
  const box = el?.getBoundingClientRect();
  if (!box?.width) return false;
  const frame = ide.getBoundingClientRect();
  pointer.style.transform = `translate(${box.left - frame.left + box.width / 2}px, ${box.top - frame.top + box.height / 2}px)`;
  return true;
}

async function tour() {
  const mine = ++run;
  const live = () => mine === run;
  state = fresh();
  ide.querySelectorAll(SCROLLERS.join()).forEach((el) => (el.scrollTop = 0));
  render();
  ide.classList.add("touring");
  replay.textContent = "Skip tour";
  for (const [i, step] of TOUR.entries()) {
    caption.replaceChildren(h("b", {}, `${i + 1} / ${TOUR.length}`), " ", step.say);
    if (pointAt(step.at())) await sleep(800);
    if (!live()) return;
    pointer.classList.add("click");
    step.act();
    await sleep(250);
    pointer.classList.remove("click");
    await sleep(2900);
    if (!live()) return;
  }
  stopTour("That's the tour. Now click around yourself.");
}

function stopTour(message) {
  run += 1;
  ide.classList.remove("touring");
  ide.querySelectorAll(".on").forEach((el) => el.classList.remove("on"));
  caption.textContent = message;
  replay.textContent = "Replay tour";
}

// Your first click takes over from the tour. The tour's own clicks are calls, not events, so they
// never land here.
ide.addEventListener("pointerdown", () => {
  if (ide.classList.contains("touring")) stopTour("Your turn. Click a tab, a box or a file.");
});
replay.addEventListener("click", () => (ide.classList.contains("touring") ? stopTour("Your turn. Click a tab, a box or a file.") : tour()));

render();
// Starts the tour the first time the window is mostly on screen. With reduced motion, it waits for a click.
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  stopTour("Click a tab, a box or a file, or play the tour.");
  replay.textContent = "Play tour";
} else {
  const seen = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    seen.disconnect();
    tour();
  }, { threshold: 0.5 });
  seen.observe(ide);
}
