/** Server packages that both the executable and the npm build leave out. */
export const serverExternals = [
	// pi-ui replaces pi's Photon image processing with Bun.Image.
	"@silvia-odwyer/photon-node",
	// Pi falls back to eager languages when its terminal-only catalog is absent.
	"highlight.js/lib/index.js",
];
