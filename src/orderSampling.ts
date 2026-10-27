export function sampleCustomers<T>(customers: readonly T[], amount: number, random = Math.random): T[] {
    if (!Number.isInteger(amount) || amount < 1 || amount > customers.length) throw new RangeError('Not enough eligible customers');
    const shuffled = [...customers];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled.slice(0, amount);
}
