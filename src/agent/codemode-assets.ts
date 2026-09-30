import { resolve } from "node:path";

import { setEmbeddedQuickJSWasmPath } from "../../node_modules/@earendil-works/pi-coding-agent/dist/config.js";
import wasmPath from "../../node_modules/quickjs-wasi/quickjs.wasm" with { type: "file" };

setEmbeddedQuickJSWasmPath(resolve(import.meta.dir, wasmPath));
