Shared synthetic SQL analytics room, built on the [assistant-ui](https://github.com/assistant-ui/assistant-ui) starter. See [SETUP.md](SETUP.md) for the current FastAPI backend, schema-aware tool-calling, data limitations and verification commands. The starter-only instructions below do not start the room backend.

## Getting Started

First, add your OpenAI API key to `.env.local` file:

```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
