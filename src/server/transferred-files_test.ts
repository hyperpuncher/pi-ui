import { test } from "bun:test";

import { assert, assertEquals, assertRejects } from "#testing/assertions";
import {
	isNotFoundError,
	readDir,
	readTextFile,
	remove,
	stat,
	writeTextFile,
} from "#testing/files";
import { makeTempDir } from "#testing/temp";

import {
	MAX_TRANSFER_FILES,
	MAX_TRANSFER_FILE_BYTES,
	MAX_TRANSFER_REQUEST_BYTES,
	MAX_TRANSFER_TOTAL_BYTES,
	getTransferredFiles,
	sanitizeFileName,
	TransferredFileStore,
	validateTransferContentLength,
	validateTransferredFiles,
} from "./transferred-files.ts";

test("transfer extraction ignores empty and non-File fields", () => {
	const formData = new FormData();
	assertEquals(getTransferredFiles(formData), []);
	formData.append("file", "not a file");
	formData.append("other", new File(["ignored"], "ignored.txt"));
	assertEquals(getTransferredFiles(formData), []);
	formData.append("file", new File(["included"], "included.txt"));
	assertEquals(
		getTransferredFiles(formData).map((file) => file.name),
		["included.txt"],
	);
});

test("transfer limits accept exact boundaries and empty input", () => {
	assertEquals(validateTransferredFiles([]), undefined);
	assertEquals(
		validateTransferredFiles(
			Array.from({ length: MAX_TRANSFER_FILES }, (_, index) => ({
				name: `${index}.txt`,
				size: index === 0 ? MAX_TRANSFER_FILE_BYTES : 0,
			})),
		),
		undefined,
	);
	assertEquals(
		validateTransferredFiles([
			{ name: "one", size: MAX_TRANSFER_FILE_BYTES },
			{ name: "two", size: MAX_TRANSFER_FILE_BYTES },
			{ name: "three", size: MAX_TRANSFER_FILE_BYTES / 2 },
		]),
		undefined,
	);
});

test("transfer limits reject one over each boundary", () => {
	assertEquals(
		validateTransferredFiles(
			Array.from({ length: MAX_TRANSFER_FILES + 1 }, (_, index) => ({
				name: `${index}.txt`,
				size: 0,
			})),
		)?.code,
		"too-many-files",
	);
	assertEquals(
		validateTransferredFiles([{ name: "large", size: MAX_TRANSFER_FILE_BYTES + 1 }])
			?.code,
		"file-too-large",
	);
	assertEquals(
		validateTransferredFiles([
			{ name: "one", size: MAX_TRANSFER_FILE_BYTES },
			{ name: "two", size: MAX_TRANSFER_FILE_BYTES },
			{
				name: "three",
				size: MAX_TRANSFER_TOTAL_BYTES - 2 * MAX_TRANSFER_FILE_BYTES + 1,
			},
		])?.code,
		"total-too-large",
	);
});

test("content length uses a looser multipart request boundary", () => {
	assertEquals(
		validateTransferContentLength(String(MAX_TRANSFER_REQUEST_BYTES)),
		undefined,
	);
	assertEquals(
		validateTransferContentLength(String(MAX_TRANSFER_REQUEST_BYTES + 1))?.code,
		"request-too-large",
	);
	assertEquals(validateTransferContentLength(null), undefined);
});

test("store validates sizes before reading any file body", async () => {
	await withTempRoot(async (tempRoot) => {
		const store = await TransferredFileStore.create({ tempRoot });
		let bodyRead = false;
		try {
			await assertRejects(() =>
				store.importFiles([
					{
						name: "too-large.txt",
						size: MAX_TRANSFER_FILE_BYTES + 1,
						arrayBuffer: () => {
							bodyRead = true;
							return Promise.resolve(new ArrayBuffer(0));
						},
					},
				]),
			);
			assert(!bodyRead, "Expected validation before reading a file body");
		} finally {
			await store.dispose();
		}
	});
});

test("store sanitizes names and generates collision-safe paths", async () => {
	await withTempRoot(async (tempRoot) => {
		const store = await TransferredFileStore.create({ tempRoot });
		try {
			const paths = await store.importFiles([
				memoryFile("../same name?.txt", "first"),
				memoryFile("../same name?.txt", "second"),
			]);
			assert(paths[0] !== paths[1], "Expected unique imported paths");
			for (const path of paths) {
				assert(
					path.startsWith(`${store.rootPath}/`),
					"Expected imports inside the owned root",
				);
				assert(
					path.endsWith(`-${sanitizeFileName("../same name?.txt")}`),
					"Expected a sanitized basename",
				);
			}
			assertEquals(await readTextFile(paths[0]), "first");
			assertEquals(await readTextFile(paths[1]), "second");
		} finally {
			await store.dispose();
		}
	});
});

test("store removes all files from a failed import", async () => {
	await withTempRoot(async (tempRoot) => {
		const store = await TransferredFileStore.create({ tempRoot });
		try {
			await assertRejects(() =>
				store.importFiles([
					memoryFile("written.txt", "written"),
					{
						name: "failed.txt",
						size: 1,
						arrayBuffer: () => Promise.reject(new Error("read failed")),
					},
				]),
			);
			const entries = [];
			for (const entry of await readDir(store.rootPath)) entries.push(entry);
			assertEquals(entries.length, 0);
		} finally {
			await store.dispose();
		}
	});
});

test("store disposal is idempotent and scoped to its owned root", async () => {
	await withTempRoot(async (tempRoot) => {
		const sibling = `${tempRoot}/keep.txt`;
		await writeTextFile(sibling, "keep");
		const store = await TransferredFileStore.create({ tempRoot });
		await store.importFiles([memoryFile("remove.txt", "remove")]);

		await store.dispose();
		await store.dispose();

		await stat(sibling);
		await assertRejects(() => stat(store.rootPath));
	});
});

function memoryFile(name: string, contents: string) {
	const bytes = new TextEncoder().encode(contents);
	return {
		name,
		size: bytes.byteLength,
		arrayBuffer: async () => bytes.slice().buffer,
	};
}

async function withTempRoot(callback: (path: string) => Promise<void>): Promise<void> {
	const path = await makeTempDir({ prefix: "pi-ui-transfer-test-" });
	try {
		await callback(path);
	} finally {
		await remove(path, { recursive: true }).catch((error) => {
			if (!isNotFoundError(error)) throw error;
		});
	}
}
