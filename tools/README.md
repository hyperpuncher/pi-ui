# build tools

build and lint dependencies live here so the root `deno.lock` and `node_modules` contain runtime dependencies only. this matters because Deno Desktop currently bundles the complete root `node_modules` directory and cannot prune unused packages ([denoland/deno#35817](https://github.com/denoland/deno/issues/35817)).

install both dependency sets with:

```sh
deno ci
cd tools && deno ci
```

use `deno task deps:update` to update both sets interactively. it also synchronizes shared client dependencies from `deno.json` to `deno.client.json`.

some Node-based tools resolve packages from the project working directory instead of the Deno config directory. the affected root tasks set `NODE_PATH` to `tools/node_modules` for that command.
