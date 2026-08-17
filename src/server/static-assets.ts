import { serveDir } from "@std/http/file-server";

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
			if (immutable) url.pathname = `/${url.pathname.slice(prefix.length)}`;
			const response = await serveDir(new Request(url, request), { fsRoot: root });
			if (!response.ok) return response;
			const headers = new Headers(response.headers);
			headers.set(
				"cache-control",
				immutable
					? "public, max-age=31536000, immutable"
					: "no-cache, must-revalidate",
			);
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		},
	};
}

async function staticContentVersion(root: string): Promise<string> {
	const paths = await staticVersionPaths(root);
	const parts: Uint8Array[] = [];
	let byteLength = 0;
	for (const path of paths) {
		const relativePath = path.slice(root.length + 1);
		const label = new TextEncoder().encode(`${relativePath}\0`);
		const contents = await Deno.readFile(path);
		parts.push(label, contents);
		byteLength += label.byteLength + contents.byteLength;
	}
	const input = new Uint8Array(byteLength);
	let offset = 0;
	for (const part of parts) {
		input.set(part, offset);
		offset += part.byteLength;
	}
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
	return Array.from(digest.slice(0, 8), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
}

async function staticVersionPaths(root: string): Promise<string[]> {
	const paths: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for await (const entry of Deno.readDir(directory)) {
			const path = `${directory}/${entry.name}`;
			if (entry.isDirectory) {
				if (path === `${root}/build/chunks` || path === `${root}/build/assets`) {
					continue;
				}
				await visit(path);
			} else if (entry.isFile && !entry.name.includes("_test.")) {
				paths.push(path);
			}
		}
	};
	await visit(root);
	return paths.sort();
}
