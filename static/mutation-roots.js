/** Returns minimal added element roots so post-morph work never rescans the document. */
export function collectAddedElementRoots(records) {
	const roots = [];
	for (const record of records) {
		for (const node of record.addedNodes ?? []) {
			if (node?.nodeType !== 1) continue;
			if (roots.some((root) => root === node || root.contains?.(node))) continue;
			for (let index = roots.length - 1; index >= 0; index -= 1) {
				if (node.contains?.(roots[index])) roots.splice(index, 1);
			}
			roots.push(node);
		}
	}
	return roots;
}
