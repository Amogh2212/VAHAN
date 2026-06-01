const TELEGRAM_API_BASE = "https://api.telegram.org";

const COMMAND_KEYBOARD = {
  keyboard: [["Query", "Map", "Summary"]],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateTelegramText(text) {
  const value = String(text ?? "");
  return value.length > 3900 ? `${value.slice(0, 3890)}...` : value;
}

export function parseAllowedChatIds(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function createTelegramBot({
  token,
  allowedChatIds,
  onMessage,
  logger = console,
  polling = true,
  allowPublicAccess = false,
}) {
  const allowedChats = allowedChatIds instanceof Set ? allowedChatIds : parseAllowedChatIds(allowedChatIds);
  let offset = 0;
  let stopped = false;

  async function api(method, payload = {}) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      throw new Error(body?.description ?? `Telegram ${method} failed: ${response.status}`);
    }
    return body.result;
  }

  function isAllowedChat(chatId) {
    return allowPublicAccess || allowedChats.has(String(chatId));
  }

  async function sendMessage(chatId, text, options = {}) {
    if (!chatId || !isAllowedChat(chatId)) return null;
    return api("sendMessage", {
      chat_id: chatId,
      text: truncateTelegramText(text),
      disable_web_page_preview: true,
      ...options,
    });
  }

  async function sendKeyboard(chatId, text) {
    return sendMessage(chatId, text, { reply_markup: COMMAND_KEYBOARD });
  }

  async function setCommands(commands) {
    if (!token) return null;
    return api("setMyCommands", { commands });
  }

  async function broadcast(text, options = {}) {
    const results = [];
    for (const chatId of allowedChats) {
      results.push(await sendMessage(chatId, text, options).catch((error) => {
        logger.warn?.(`[telegram] send failed for ${chatId}: ${error.message}`);
        return null;
      }));
    }
    return results;
  }

  async function pollLoop() {
    logger.log?.("[telegram] polling enabled");
    while (!stopped) {
      try {
        const updates = await api("getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["message"],
        });
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          const message = update.message;
          const chatId = message?.chat?.id;
          const text = message?.text?.trim();
          if (!chatId || !text || !isAllowedChat(chatId)) continue;
          await onMessage?.({ chatId, text, message, bot });
        }
      } catch (error) {
        logger.warn?.(`[telegram] polling error: ${error.message}`);
        await sleep(5000);
      }
    }
  }

  function start() {
    if (!token || (!allowPublicAccess && allowedChats.size === 0) || !polling) return;
    void pollLoop();
  }

  function stop() {
    stopped = true;
  }

  const bot = {
    api,
    broadcast,
    isAllowedChat,
    setCommands,
    sendKeyboard,
    sendMessage,
    start,
    stop,
  };

  return bot;
}
