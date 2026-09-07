const $ = (selector) => document.querySelector(selector);
let csrfToken;

async function api(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(!["GET", "HEAD"].includes(method) && csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function notice(message, type = "info") {
  const element = $("#accountNotice");
  element.hidden = !message;
  element.dataset.type = type;
  element.textContent = message || "";
}

function setUser(user) {
  $("#signedOut").hidden = Boolean(user);
  $("#accountWorkspace").hidden = !user;
  if (!user) return;
  const name = user.name || user.email;
  $("#accountName").textContent = name;
  $("#accountEmail").textContent = user.email;
  $("#accountInitial").textContent = name.trim()[0].toUpperCase();
  if (user.createdAt) $("#memberSince").textContent = `Member since ${new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(user.createdAt))}`;
}

$("#logoutBtn").onclick = async () => { await api("/auth/logout", { method: "POST" }); csrfToken = null; setUser(null); notice("You have signed out.", "success"); };
$("#exportBtn").onclick = async () => { const body = await api("/api/account/export"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(body.account, null, 2)], { type: "application/json" })); link.download = "vahan-analyst-account-data.json"; link.click(); URL.revokeObjectURL(link.href); notice("Your account-data download has started.", "success"); };
$("#deleteBtn").onclick = () => { $("#deleteConfirm").value = ""; $("#deleteError").hidden = true; $("#deleteDialog").showModal(); };
$("#cancelDelete").onclick = () => $("#deleteDialog").close();
$("#deleteDialog").onsubmit = async (event) => { event.preventDefault(); if ($("#deleteConfirm").value !== "DELETE") { $("#deleteError").textContent = "Type DELETE exactly to confirm permanent deletion."; $("#deleteError").hidden = false; return; } await api("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }); $("#deleteDialog").close(); setUser(null); notice("Your account has been deleted.", "success"); };
api("/api/me").then((body) => { csrfToken = body.csrfToken || null; setUser(body.user); }).catch((error) => notice(error.message, "error"));
