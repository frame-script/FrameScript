export class Store<T> {
    private listeners = new Set<(value: T) => void>
    private value: T

    constructor(value: T) {
        this.value = value
    }

    public get(): T {
        return this.value
    }

    public set(value: T) {
        this.value = value
        for (let listener of this.listeners) {
            listener(value)
        }
    }

    public subscribe(listener: (value: T) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }
}
