function hasFileSystemCode(cause: unknown, code: string): boolean {
	return cause instanceof Error && "code" in cause && cause.code === code;
}

export function isAlreadyExists(cause: unknown): boolean {
	return hasFileSystemCode(cause, "EEXIST");
}

export function isNotFound(cause: unknown): boolean {
	return hasFileSystemCode(cause, "ENOENT");
}

export function isPermissionDenied(cause: unknown): boolean {
	return hasFileSystemCode(cause, "EACCES") || hasFileSystemCode(cause, "EPERM");
}
