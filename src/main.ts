import { createApp } from "./server/app.ts";

Deno.serve((await createApp()).fetch);
