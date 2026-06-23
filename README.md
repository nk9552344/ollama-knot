# ollama-knot
a web app to interact with ollama models to use mcp servers


-----


**Project: MCP Studio — Ollama Chat Interface with MCP Server Management**

Build a **Next.js 14 (JavaScript + Tailwind CSS)** web application called **MCP Studio**. This is a local-only tool — no auth, no deployment, runs inside Docker alongside an Ollama instance. Persistence is via JSON files on the filesystem (Docker volume), handled by Next.js API routes.

---

## Stack & Setup

- Next.js 14 (pages router, JavaScript only — no TypeScript)
- Tailwind CSS
- Zustand for client-side state
- `lucide-react` for icons
- `react-markdown` + `react-syntax-highlighter` for rendering chat messages
- `uuid` for generating IDs
- Font: Inter (via `https://rsms.me/inter/inter.css`)
- Data persisted to `/data/*.json` files (configurable via `DATA_DIR` env var, default `./data`)
- Ollama host configurable via `NEXT_PUBLIC_OLLAMA_HOST` env var, default `http://localhost:11434`

---

## Visual Design

Dark theme matching Claude.ai's dark mode aesthetic:

```
--bg: #0a0a0a
--bg-raised: #141414
--bg-overlay: #1c1c1c
--bg-hover: #222222
--bg-active: #2a2a2a
--border: #2a2a2a
--text-primary: #ececec
--text-secondary: #8c8c8c
--text-muted: #4a4a4a
--accent: #b5681e (warm amber)
--status-green: #22c55e
--status-red: #ef4444
```

- Minimal, clean UI — no gradients, no shadows, no cheap-looking elements
- Sidebar navigation (260px wide, collapsible on mobile)
- Every section has its own dedicated page
- Responsive: works on both mobile and desktop
- Smooth micro-transitions (150–200ms) on hovers and state changes
- No file upload button anywhere

---

## Layout

```
┌─────────────┬──────────────────────────────────┐
│   Sidebar   │         Page Content              │
│  (260px)    │                                   │
│             │                                   │
│  Logo       │                                   │
│  ─────────  │                                   │
│  Chats      │                                   │
│   + New     │                                   │
│   [list]    │                                   │
│  ─────────  │                                   │
│  MCP Servers│                                   │
│  Sys Prompts│                                   │
│  Models     │                                   │
└─────────────┴──────────────────────────────────┘
```

On mobile: sidebar becomes a slide-over drawer, toggled by a hamburger button in a top nav bar.

---

## Pages & Routes

### `/` → Chat Page

- Shows the active chat, or an empty state if no chat is selected
- Empty state has a "New Chat" button
- **New Chat flow**: clicking "New Chat" opens a small panel/modal where the user selects:
  - Model (required — dropdown from Ollama)
  - System Prompt (optional — dropdown from saved system prompts)
  - MCP Servers (optional — multi-select checkboxes from saved active MCP servers)
  - Then clicks "Start Chat"
- The selected model, system prompt, and MCP servers are stored on the chat object
- Chat title is auto-generated from the first user message (first 50 chars)
- **Users cannot create a new chat while `isStreaming === true`** — the "New Chat" button is disabled with a tooltip "Wait for response to finish"
- Messages are displayed in a scrollable area with auto-scroll to bottom
- User messages: right-aligned bubble, accent-tinted background
- Assistant messages: left-aligned, no bubble, just text with the model icon
- Markdown rendered in assistant messages (code blocks with syntax highlighting using `vscDarkPlus` theme)
- Streaming: assistant message appears and content streams in token by token with a blinking cursor
- A small "thinking" animation (3 bouncing dots) shows before the first token arrives
- Chat input: fixed at the bottom, textarea that grows up to 5 lines, sends on Enter (Shift+Enter for newline), disabled while streaming
- Above the input bar, show pills for the active chat's model, system prompt (if any), and MCP servers (if any) — clicking a pill does nothing, it's just informational
- Each chat in the sidebar shows its title and a delete button (trash icon) on hover
- Full message history is sent to Ollama on every turn (context window)

### `/mcp-servers` → MCP Servers Page

- Page title: "MCP Servers"
- A list of all saved MCP servers displayed as cards
- Each card shows:
  - Name (bold)
  - Type badge: `http` or `stdio`
  - Description (muted text)
  - Active/Inactive status toggle (green dot = active, red = inactive)
  - Edit button, Delete button
- "Add Server" button (top right) opens a modal with the form:
  - Name (text input, required)
  - Type: `http` or `stdio` (radio/select — switching type shows/hides relevant fields)
  - If `http`: URL field
  - If `stdio`: Command field, Args field (comma-separated), Env vars (key=value pairs, add/remove rows)
  - Description (optional textarea)
  - Active toggle (default: true)
- Edit opens the same modal pre-filled
- Delete shows a confirmation inline (not a browser confirm())
- Toggling active/inactive updates immediately via PATCH
- Empty state: "No MCP servers yet. Add one to get started."

**MCP Server data schema:**
```json
{
  "id": "uuid",
  "name": "string",
  "type": "http" | "stdio",
  "url": "string (http only)",
  "command": "string (stdio only)",
  "args": ["string"] ,
  "env": { "KEY": "VALUE" },
  "description": "string",
  "active": true,
  "createdAt": "ISO string"
}
```

### `/system-prompts` → System Prompts Page

- Page title: "System Prompts"
- List of saved system prompts as cards
- Each card shows: Name, description (truncated), preview of content (truncated), Edit + Delete buttons
- "New Prompt" button (top right) opens a modal/inline editor:
  - Name (required)
  - Description (optional)
  - Content (large textarea — this is the actual system prompt text)
  - The content field supports a special variable: `${USER_PROMPT}` — when this appears in the template, the user's message will be injected here instead of being appended normally. Show a small hint below the textarea explaining this.
- Edit opens the same form pre-filled
- Delete with inline confirmation
- Empty state with helpful message

**System prompt injection logic (in `lib/ollama.js`):**
```js
function buildFinalMessages(systemPromptContent, chatMessages) {
  if (!systemPromptContent) return chatMessages
  if (systemPromptContent.includes('${USER_PROMPT}')) {
    const lastUserMsg = chatMessages[chatMessages.length - 1]
    const injected = systemPromptContent.replace('${USER_PROMPT}', lastUserMsg.content)
    return [
      ...chatMessages.slice(0, -1),
      { role: 'user', content: injected }
    ]
  }
  return [{ role: 'system', content: systemPromptContent }, ...chatMessages]
}
```

**System prompt data schema:**
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "content": "string",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

### `/models` → Models Page

- Page title: "Models"
- Shows all models currently available in Ollama
- Each model shown as a row/card with: name, size (formatted), modified date
- Delete button with inline confirmation per model
- "Pull Model" section at the top: text input + button, shows streaming progress line by line (status messages from Ollama's pull API streamed via SSE from `/api/models/pull`)
- Pull progress shows the current status string and a percentage if available
- Empty state if Ollama is unreachable with a helpful error message

---

## API Routes (Next.js pages/api)

All data stored in `/data/` as JSON files. Use a shared `lib/store.js` utility:
```js
// lib/store.js
import fs from 'fs'
import path from 'path'
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
export function readStore(name) { /* read /data/{name}.json, return [] if missing */ }
export function writeStore(name, data) { /* write /data/{name}.json */ }
```

**Routes:**
- `GET/POST /api/chats` — list all, create new
- `GET/PATCH/DELETE /api/chats/[id]` — single chat ops
- `GET/POST /api/mcp-servers` — list all, create new
- `GET/PATCH/DELETE /api/mcp-servers/[id]` — single server ops
- `GET/POST /api/system-prompts` — list all, create
- `GET/PATCH/DELETE /api/system-prompts/[id]` — single prompt ops
- `GET /api/models` — proxies to Ollama `/api/tags`, returns sorted model list
- `DELETE /api/models` — proxies to Ollama `/api/delete` with `{ name }`
- `POST /api/models/pull` — proxies Ollama pull with SSE streaming, forwards each JSON line as `data: ...\n\n`

---

## State Management (Zustand — `store/index.js`)

Single store with:
- `chats[]`, `activeChatId`, `isStreaming`
- `mcpServers[]`, `systemPrompts[]`, `models[]`
- `sidebarOpen` (boolean)
- Actions: `fetchChats`, `createChat`, `updateChat`, `deleteChat`
- `appendMessage(chatId, message)` — adds message and persists to API
- `updateLastAssistantMessage(chatId, content)` — optimistic local update during streaming (does NOT call API on every chunk)
- `persistMessages(chatId)` — called once after streaming ends, saves final messages to API
- `fetchMcpServers`, `createMcpServer`, `updateMcpServer`, `deleteMcpServer`
- `fetchSystemPrompts`, `createSystemPrompt`, `updateSystemPrompt`, `deleteSystemPrompt`
- `fetchModels`, `deleteModel`
- `setIsStreaming(bool)`, `setSidebarOpen(bool)`, `setActiveChatId(id)`

---

## Ollama Streaming (`lib/ollama.js`)

```js
export async function streamChat({ model, messages, systemPromptContent, onChunk, onDone, onError })
```

- Calls `NEXT_PUBLIC_OLLAMA_HOST/api/chat` directly from the browser (not proxied)
- Applies `buildFinalMessages` before sending
- Streams response, calls `onChunk(tokenString)` per token
- Calls `onDone(fullContent)` when stream ends

---

## Chat Data Schema

```json
{
  "id": "uuid",
  "title": "string",
  "model": "string",
  "systemPromptId": "uuid | null",
  "mcpServerIds": ["uuid"],
  "messages": [
    { "role": "user" | "assistant", "content": "string" }
  ],
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

---

## Component Structure

```
components/
  Layout.js          — sidebar + main content wrapper
  Sidebar.js         — nav links, chat list, new chat button
  Button.js          — variants: default, primary, ghost, danger
  Modal.js           — reusable modal with ESC to close
  FormElements.js    — Input, Textarea, Select components
  Toggle.js          — on/off switch
  ChatMessage.js     — renders a single message (markdown for assistant)
  ChatInput.js       — textarea + send button + context pills
  NewChatModal.js    — model/system prompt/MCP server selector
  ConfirmInline.js   — inline "Are you sure? Yes / Cancel" UI (no browser confirm())
  StatusDot.js       — green/red dot indicator
  ThinkingDots.js    — 3 bouncing dots animation for streaming state
pages/
  index.js           — Chat page
  mcp-servers.js     — MCP Servers page
  system-prompts.js  — System Prompts page
  models.js          — Models page
```

---

## Docker

Include a `Dockerfile` and `docker-compose.yml`:

**Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  mcp-studio:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - OLLAMA_HOST=http://ollama:11434
      - NEXT_PUBLIC_OLLAMA_HOST=http://localhost:11434
    depends_on:
      - ollama
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
volumes:
  ollama_data:
```

> Note on `NEXT_PUBLIC_OLLAMA_HOST`: this is the URL the **browser** uses to stream directly from Ollama. Inside Docker, the browser talks to Ollama via the host machine's exposed port (`localhost:11434`), not the container network name. `OLLAMA_HOST` (without `NEXT_PUBLIC_`) is used by the server-side API routes to proxy pull/delete/list.

---

## Key Behaviours to Get Right

1. **Streaming**: `updateLastAssistantMessage` only updates Zustand state during streaming. `persistMessages` is called exactly once when `onDone` fires — this is the only API write for the assistant message.
2. **No new chat while streaming**: Gate the "New Chat" button with `isStreaming`. Show a tooltip explaining why it's disabled.
3. **Auto-title**: When `appendMessage` is called with the first user message and `chat.title === 'New Chat'`, set title to `message.content.slice(0, 50)`.
4. **Context pills**: Above the chat input, show non-clickable pills for the active chat's model name, system prompt name, and each active MCP server name.
5. **MCP servers in chat**: MCP servers are informational metadata on the chat object for now — they are displayed as context pills but not actually invoked. The architecture should make it easy to wire them up later.
6. **Sidebar chat list**: Shows all chats sorted by `updatedAt` descending. Active chat is highlighted. Each item shows title + trash icon on hover. Clicking navigates to that chat (sets `activeChatId`).
7. **Mobile**: Sidebar collapses to a drawer. Top bar shows hamburger + "MCP Studio" title. Main content is full width.
8. **No browser `confirm()`**: All destructive actions use an inline confirmation pattern — clicking delete reveals "Confirm delete? [Yes] [Cancel]" in place.
9. **Empty states**: Every list page has a thoughtful empty state with an icon and a call-to-action.
10. **Modular code**: Each component does one thing. No god components. Pages are thin orchestrators.