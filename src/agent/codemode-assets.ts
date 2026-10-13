import { resolve } from "node:path";

import wasmPath from "quickjs-wasi/quickjs.wasm" with { type: "file" };

import { setEmbeddedQuickJSWasmPath } from "#pi/config.js";

setEmbeddedQuickJSWasmPath(resolve(import.meta.dir, wasmPath));
