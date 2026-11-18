# Stillnote · AI Knowledge Inbox

A single-user React and Express app for saving notes and web pages, then asking questions across saved content. It runs locally without an API key. With an OpenAI key it uses OpenAI embeddings and chat answers; offline it uses local hashed word and character-trigram embeddings and a grounded excerpt answer.

## Run locally

Requires Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (usually `http://localhost:5173`). The API runs on port 3001. To enable generated answers, copy `.env.example` to `.env` and add `OPENAI_API_KEY`. The key stays on the server. URL imports need the server to access the public page.

For a production build, run `npm run build` and then `npm start` with `NODE_ENV=production`. Data is stored in `data/knowledge.sqlite`; override the location with `DATABASE_PATH` or the port with `PORT`.

## API

- `POST /ingest` — `{ "type": "note", "text": "..." }` or `{ "type": "url", "url": "https://..." }`
- `GET /items` — item metadata and previews
- `POST /query` — `{ "question": "..." }`; returns an answer and ranked source snippets
- `GET /health` — status and active answer mode

Errors use a JSON `{ "error": "..." }` body. Server logs are JSON lines.

## Design choices and tradeoffs

- Text is cleaned and split into 900-character chunks with 140-character overlap. This preserves some context across chunk boundaries while keeping retrieval context bounded.
- SQLite stores content, chunk metadata, and vectors. Retrieval scans chunks and ranks with cosine similarity. For a larger corpus, use a vector index, batch embedding jobs, and add pagination and retention controls.
- Local vectors use signed feature hashing over words and character trigrams. This is useful for a no-key demo but is less capable than trained semantic embeddings, especially for paraphrases and multilingual content.
- URL fetching accepts HTTP(S), limits redirects, response size, and time, and rejects obvious private/local host addresses. A hardened deployment should validate DNS at connection time and fetch through an isolated proxy.
- There is no authentication because the assignment allows a single user. A public deployment needs authentication, rate limiting, strict SSRF controls, secrets management, HTTPS, and backups.
