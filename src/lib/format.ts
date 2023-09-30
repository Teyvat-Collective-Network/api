export enum DurationStyle {
    Blank,
    For,
    Until,
}

export function unparseDuration(duration: number, style = DurationStyle.For): string {
    if (duration === Infinity) return "indefinitely";

    duration = Math.round(duration / 1000);

    if (duration < 0) {
        const core = _unparseDuration(-duration);

        switch (style) {
            case DurationStyle.Blank:
                return `negative ${core}`;
            case DurationStyle.For:
                return `for negative ${core}`;
            case DurationStyle.Until:
                return `until ${core} ago`;
        }
    }

    if (duration === 0)
        switch (style) {
            case DurationStyle.Blank:
                return "no time";
            case DurationStyle.For:
                return "for no time";
            case DurationStyle.Until:
                return "until right now";
        }

    const core = _unparseDuration(duration);

    switch (style) {
        case DurationStyle.Blank:
            return core;
        case DurationStyle.For:
            return `for ${core}`;
        case DurationStyle.Until:
            return `until ${core} from now`;
    }
}

const timescales: [string, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
];

function _unparseDuration(duration: number): string {
    if (duration === Infinity) return "indefinitely";

    const parts: string[] = [];

    for (const [name, scale] of timescales) {
        if (duration >= scale) {
            const amount = Math.floor(duration / scale);
            duration %= scale;

            parts.push(`${amount} ${name}${amount === 1 ? "" : "s"}`);
        }
    }

    return parts.join(" ");
}
