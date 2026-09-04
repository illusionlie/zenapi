export function parseApiKeys(apiKey: string): string[] {
	return apiKey
		.split("\n")
		.map((k) => k.trim())
		.filter(Boolean);
}

export function shuffleArray<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}
