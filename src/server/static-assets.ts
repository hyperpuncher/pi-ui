import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

export interface StaticAssetServer {
	readonly version: string;
	serve(request: Request): Promise<Response>;
}

export async function createStaticAssetServer(root: string): Promise<StaticAssetServer> {
	const version = await staticContentVersion(root);
	const prefix = `/static/${version}/`;
	return {
		version,
		serve: async (request) => {
			const url = new URL(request.url);
			const immutable = url.pathname.startsWith(prefix);
			const pathname = immutable
				? `/${url.pathname.slice(prefix.length)}`
				: url.pathname;
			const path = safeStaticPath(root, pathname);
			if (!path) return new Response("Not found", { status: 404 });
			try {
				if (!(await stat(path)).isFile()) {
					return new Response("Not found", { status: 404 });
				}
			} catch {
				return new Response("Not found", { status: 404 });
			}
			return new Response(Bun.file(path), {
				headers: {
					"cache-control": immutable
						? "public, max-age=31536000, immutable"
						: "no-cache, must-revalidate",
					"content-type": contentType(path),
				},
			});
		},
	};
}

function safeStaticPath(root: string, pathname: string): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const path = resolve(root, `.${decoded}`);
	const relativePath = relative(root, path);
	if (relativePath.startsWith(`..${sep}`) || relativePath === "..") return undefined;
	return path;
}

function contentType(path: string): string {
	return (
		{
			".css": "text/css; charset=utf-8",
			".gif": "image/gif",
			".html": "text/html; charset=utf-8",
			".ico": "image/x-icon",
			".jpeg": "image/jpeg",
			".jpg": "image/jpeg",
			".js": "text/javascript; charset=utf-8",
			".json": "application/json; charset=utf-8",
			".png": "image/png",
			".svg": "image/svg+xml",
			".wasm": "application/wasm",
			".webmanifest": "application/manifest+json; charset=utf-8",
			".webp": "image/webp",
		}[extname(path).toLowerCase()] ?? "application/octet-stream"
	);
}

async function staticContentVersion(root: string): Promise<string> {
	const paths = await staticVersionPaths(root);
	const hasher = new Bun.CryptoHasher("sha256");
	for (const path of paths) {
		hasher.update(`${relative(root, path)}\0`);
		hasher.update(await readFile(path));
	}
	return hasher.digest("hex").slice(0, 16);
}

async function staticVersionPaths(root: string): Promise<string[]> {
	const paths: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				if (
					path === resolve(root, "build/chunks") ||
					path === resolve(root, "build/assets")
				) {
					continue;
				}
				await visit(path);
			} else if (entry.isFile() && !entry.name.includes("_test.")) {
				paths.push(path);
			}
		}
	};
	await visit(root);
	return paths.sort();
}
