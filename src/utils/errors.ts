export function errorMessage(error: ErrorOptions["cause"]): string {
	return error instanceof Error ? error.message : String(error);
}
