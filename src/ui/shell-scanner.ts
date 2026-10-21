export type ShellQuoted = {
	quote: "'" | '"' | "`";
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
	simple: boolean;
	closed: boolean;
};

export type ShellWord = {
	start: number;
	end: number;
	value: string;
	quoted: ShellQuoted[];
	redirectedBy?: string;
};

export type ShellOperator = {
	start: number;
	end: number;
	value: string;
};

export type ShellSegment = {
	start: number;
	end: number;
	words: ShellWord[];
};

export type ShellLine = {
	start: number;
	end: number;
	newlineEnd: number;
	words: ShellWord[];
	operators: ShellOperator[];
};

export type ShellHeredoc = {
	start: number;
	end: number;
	marker: string;
	lineIndex: number;
	operatorStart: number;
};

export type ShellScan = {
	lines: ShellLine[];
	heredocs: ShellHeredoc[];
	bodyRanges: ReadonlyArray<readonly [start: number, end: number]>;
};

const operatorStart = new Set("&;<>|(){}");
const redirectOperators = new Set(["<<-", ">>", "<<", ">|", ">&", "<&", ">", "<"]);
const segmentOperators = new Set([";;&", "&&", "||", "|&", ";;", ";&", "|", ";", "&"]);

// fallow-ignore-next-line complexity
export function scanShell(source: string): ShellScan {
	const lines: ShellLine[] = [];
	let line = newLine(0);
	let offset = 0;
	let redirect: string | undefined;
	while (offset < source.length) {
		const char = source[offset]!;
		if (char === "\n" || char === "\r") {
			const end =
				char === "\r" && source[offset + 1] === "\n" ? offset + 2 : offset + 1;
			line.end = offset;
			line.newlineEnd = end;
			lines.push(line);
			line = newLine(end);
			redirect = undefined;
			offset = end;
			continue;
		}
		if (/\s/.test(char)) {
			offset += 1;
			continue;
		}
		if (char === "#") {
			const end = source.indexOf("\n", offset);
			offset = end < 0 ? source.length : end;
			continue;
		}
		const operator = operatorStart.has(char) ? operatorAt(source, offset) : undefined;
		if (operator) {
			line.operators.push({
				start: offset,
				end: offset + operator.length,
				value: operator,
			});
			redirect = redirectOperators.has(operator) ? operator : undefined;
			offset += operator.length;
			continue;
		}
		const word = readWord(source, offset);
		if (redirect) {
			word.redirectedBy = redirect;
			redirect = undefined;
		}
		line.words.push(word);
		offset = word.end;
	}
	line.end = source.length;
	line.newlineEnd = source.length;
	lines.push(line);
	const heredocs = findHeredocs(source, lines);
	return {
		lines,
		heredocs,
		bodyRanges: heredocs.map((heredoc) => [heredoc.start, heredoc.end] as const),
	};
}

export function isInRanges(offset: number, ranges: ShellScan["bodyRanges"]): boolean {
	return ranges.some(([start, end]) => offset >= start && offset < end);
}

export function lineSegments(line: ShellLine): ShellSegment[] {
	const segments: ShellSegment[] = [];
	let words: ShellWord[] = [];
	let wordIndex = 0;
	const finish = () => {
		if (words.length === 0) return;
		segments.push({
			start: words[0]!.start,
			end: words.at(-1)!.end,
			words,
		});
		words = [];
	};
	for (const operator of line.operators) {
		while (
			wordIndex < line.words.length &&
			line.words[wordIndex]!.start < operator.start
		)
			words.push(line.words[wordIndex++]!);
		if (segmentOperators.has(operator.value)) finish();
	}
	while (wordIndex < line.words.length) words.push(line.words[wordIndex++]!);
	finish();
	return segments;
}

function newLine(start: number): ShellLine {
	return { start, end: start, newlineEnd: start, words: [], operators: [] };
}

const operatorsByStart = new Map<string, readonly string[]>([
	["&", ["&&", "&"]],
	[";", [";;&", ";;", ";&", ";"]],
	["<", ["<<-", "<<", "<&", "<"]],
	[">", [">>", ">|", ">&", ">"]],
	["|", ["||", "|&", "|"]],
	["(", ["("]],
	[")", [")"]],
	["{", ["{"]],
	["}", ["}"]],
]);

function operatorAt(source: string, offset: number): string | undefined {
	const candidates = operatorsByStart.get(source[offset]!);
	if (!candidates) return undefined;
	for (const operator of candidates)
		if (source.startsWith(operator, offset)) return operator;
	return undefined;
}

function findHeredocs(source: string, lines: ShellLine[]): ShellHeredoc[] {
	const heredocs: ShellHeredoc[] = [];
	for (const [lineIndex, line] of lines.entries()) {
		const operators = line.operators.filter(
			(operator) => operator.value === "<<" || operator.value === "<<-",
		);
		// Multiple queued heredocs are not supported.
		if (operators.length !== 1) continue;
		const operator = operators[0]!;
		const marker = line.words.find((word) => word.start > operator.start);
		if (!marker || line.end >= source.length) continue;
		const bodyStart = line.newlineEnd;
		const bodyEnd = heredocEnd(
			source,
			lines,
			lineIndex + 1,
			marker.value,
			operator.value === "<<-",
		);
		if (bodyEnd === undefined || bodyEnd <= bodyStart) continue;
		heredocs.push({
			start: bodyStart,
			end: bodyEnd,
			marker: marker.value,
			lineIndex,
			operatorStart: operator.start,
		});
	}
	return heredocs;
}

function heredocEnd(
	source: string,
	lines: ShellLine[],
	startIndex: number,
	marker: string,
	indent: boolean,
): number | undefined {
	for (let index = startIndex; index < lines.length; index++) {
		const line = lines[index]!;
		const text = source.slice(line.start, line.end);
		if ((indent ? text.replace(/^\t+/, "") : text) !== marker) continue;
		let end = line.start;
		if (source[end - 1] === "\n") end -= 1;
		if (source[end - 1] === "\r") end -= 1;
		return end;
	}
	return undefined;
}

// fallow-ignore-next-line complexity
function readWord(source: string, start: number): ShellWord {
	let offset = start;
	let value = "";
	const quoted: ShellQuoted[] = [];
	while (offset < source.length) {
		const char = source[offset]!;
		if (/\s/.test(char) || char === "\n" || char === "\r") break;
		if (operatorStart.has(char) && operatorAt(source, offset)) break;
		if (char === "\\") {
			offset += 1;
			if (offset < source.length && !/[\r\n]/.test(source[offset]!)) {
				value += source[offset]!;
				offset += 1;
			}
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			const segment = readQuoted(source, offset, char);
			quoted.push(segment);
			value += source.slice(segment.contentStart, segment.contentEnd);
			offset = segment.end;
			continue;
		}
		if (char === "$" && source[offset + 1] === "'") {
			const segment = readAnsiQuote(source, offset);
			quoted.push(segment);
			value += source.slice(segment.contentStart, segment.contentEnd);
			offset = segment.end;
			continue;
		}
		value += char;
		offset += 1;
	}
	return { start, end: offset, value, quoted };
}

// fallow-ignore-next-line complexity
function readQuoted(source: string, start: number, quote: "'" | '"' | "`"): ShellQuoted {
	const contentStart = start + 1;
	let offset = contentStart;
	let simple = quote !== "`";
	if (quote === "'") {
		while (offset < source.length && source[offset] !== "'") offset += 1;
	} else {
		while (offset < source.length) {
			const char = source[offset]!;
			if (char === quote) break;
			if (quote === '"' && char === "\\") {
				simple = false;
				offset += 2;
				continue;
			}
			if (quote === '"' && (char === "$" || char === "`")) simple = false;
			offset += 1;
		}
	}
	const contentEnd = Math.min(offset, source.length);
	return {
		quote,
		start,
		end: Math.min(offset + 1, source.length),
		contentStart,
		contentEnd,
		simple,
		closed: offset < source.length && source[offset] === quote,
	};
}

function readAnsiQuote(source: string, start: number): ShellQuoted {
	const contentStart = start + 2;
	let offset = contentStart;
	while (offset < source.length) {
		const char = source[offset]!;
		if (char === "'") break;
		offset += char === "\\" ? 2 : 1;
	}
	const contentEnd = Math.min(offset, source.length);
	return {
		quote: "'",
		start,
		end: Math.min(offset + 1, source.length),
		contentStart,
		contentEnd,
		simple: false,
		closed: offset < source.length && source[offset] === "'",
	};
}
