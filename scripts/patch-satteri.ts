// Temporary workaround for https://github.com/bruits/satteri/issues/151.
// Remove this script and its CI/release steps once a Sätteri release includes
// https://github.com/bruits/satteri/pull/153.
const expectedPackageName = "@bruits/satteri-wasm32-wasi";
const expectedVersion = "0.9.5";
const packageUrl = new URL(import.meta.resolve(`${expectedPackageName}/package.json`));
const bindingUrl = new URL(
	import.meta.resolve(`${expectedPackageName}/satteri_napi.wasi-browser.js`),
);
const localNodeModulesUrl = new URL("../node_modules/", import.meta.url);

if (!bindingUrl.href.startsWith(localNodeModulesUrl.href)) {
	throw new Error(
		`Refusing to patch Sätteri outside the project node_modules directory: ${bindingUrl}`,
	);
}

const packageJson = JSON.parse(await Deno.readTextFile(packageUrl)) as {
	name?: string;
	version?: string;
};
if (packageJson.name !== expectedPackageName || packageJson.version !== expectedVersion) {
	throw new Error(
		`Expected ${expectedPackageName}@${expectedVersion}, found ${packageJson.name ?? "unknown"}@${packageJson.version ?? "unknown"}`,
	);
}

const syncImport = "instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync,";
const asyncImport = "instantiateNapiModule as __emnapiInstantiateNapiModule,";
const syncCall = "} = __emnapiInstantiateNapiModuleSync(__wasmFile, {";
const asyncCall = "} = await __emnapiInstantiateNapiModule(__wasmFile, {";
const source = await Deno.readTextFile(bindingUrl);
const hasSyncLoader = source.includes(syncImport) && source.includes(syncCall);
const hasAsyncLoader = source.includes(asyncImport) && source.includes(asyncCall);

if (hasAsyncLoader && !hasSyncLoader) {
	console.log(`Sätteri async WASM patch already applied to ${bindingUrl.pathname}`);
	Deno.exit(0);
}
if (!hasSyncLoader || hasAsyncLoader) {
	throw new Error(
		"Sätteri browser binding does not match the expected 0.9.5 source; remove or update the temporary patch",
	);
}

const patched = source.replace(syncImport, asyncImport).replace(syncCall, asyncCall);
if (patched === source || patched.includes(syncImport) || patched.includes(syncCall)) {
	throw new Error("Failed to apply the Sätteri async WASM patch cleanly");
}

// Deno installs npm files as hard links into its global cache. Replace the
// project file instead of modifying that shared inode in place.
const temporaryBindingUrl = new URL(`${bindingUrl.href}.pi-ui.tmp`);
try {
	await Deno.writeTextFile(temporaryBindingUrl, patched);
	await Deno.rename(temporaryBindingUrl, bindingUrl);
} finally {
	await Deno.remove(temporaryBindingUrl).catch((error: unknown) => {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	});
}
console.log(`Applied Sätteri async WASM patch to ${bindingUrl.pathname}`);
