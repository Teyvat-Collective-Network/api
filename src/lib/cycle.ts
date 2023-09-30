export default function (fn: (...args: any[]) => any, length: number) {
    setTimeout(() => setInterval(fn, length), length - (Date.now() % length));
}
